"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../catalog.js");
const { createDraft, filterModels } = require("../workflow.js");

test("every sample template has a connected path from its inputs to its output", () => {
  for (const model of catalog.models) for (const template of model.templates) {
    const draft = createDraft({ modelId: model.id, templateId: template.id });
    assert.equal(draft.demo, true);
    assert.equal(draft.executable, false);
    assert.equal(draft.compatibility, "unverified");
    const ids = new Set(draft.graph.nodes.map(node => node.id));
    assert.equal(ids.size, draft.graph.nodes.length);
    for (const edge of draft.graph.edges) {
      assert.ok(ids.has(edge.from) && ids.has(edge.to), "no dangling edge");
    }
    for (const source of draft.graph.nodes.filter(node => node.source)) {
      const reachable = new Set([source.id]);
      for (let n = 0; n < ids.size; n++) for (const edge of draft.graph.edges) {
        if (reachable.has(edge.from)) reachable.add(edge.to);
      }
      assert.ok(reachable.has("output"), model.id + ":" + template.id + ":" + source.id);
    }
    assert.ok(draft.graph.nodes.every(node => node.x >= 0 && node.y >= 0 && node.x + node.width <= draft.graph.width && node.y + node.height <= draft.graph.height));
  }
});

test("model/template mismatch and stale model IDs cannot prepare a draft", () => {
  assert.throws(() => createDraft({ modelId: "demo-flux", templateId: "text-to-video" }));
  assert.throws(() => createDraft({ modelId: "missing-model", templateId: "text-to-image" }));
});

test("settings are scoped to the selected template and enforce allowed values", () => {
  assert.throws(() => createDraft({ modelId: "demo-qwen", templateId: "text-generation", settings: { aspect: "16:9" } }));
  assert.throws(() => createDraft({ modelId: "demo-flux", templateId: "text-to-image", settings: { aspect: "arbitrary" } }));
  assert.throws(() => createDraft({ modelId: "demo-flux", templateId: "text-to-image", settings: null }));
  const draft = createDraft({ modelId: "demo-flux", templateId: "text-to-image", settings: { aspect: "16:9", quality: "detail" } });
  assert.deepEqual(draft.settings, { aspect: "16:9", quality: "detail" });
});

test("reference templates add the asset input and its connection", () => {
  for (const [modelId, templateId] of [["demo-flux", "image-to-image"], ["demo-wan", "image-to-video"]]) {
    const graph = createDraft({ modelId, templateId }).graph;
    assert.ok(graph.nodes.some(node => node.id === "reference"));
    assert.ok(graph.edges.some(edge => edge.from === "reference" && edge.to === "process"));
  }
});

test("LLM and embedding drafts do not inherit image samplers or VAE settings", () => {
  for (const [modelId, templateId] of [["demo-qwen", "text-generation"], ["demo-bge", "text-embedding"]]) {
    const draft = createDraft({ modelId, templateId });
    assert.ok(!Object.hasOwn(draft.settings, "aspect"));
    assert.ok(!draft.graph.nodes.some(node => node.id === "decode"));
    assert.equal(draft.graph.nodes.length, 4);
  }
});

test("search is case-insensitive and intersects with the category", () => {
  assert.deepEqual(filterModels("all", "  FlUx  ").map(model => model.id), ["demo-flux"]);
  assert.deepEqual(filterModels("video", "flux"), []);
  assert.deepEqual(filterModels("embedding", "텍스트").map(model => model.id), ["demo-bge"]);
  assert.deepEqual(filterModels("all", "no-such-model"), []);
});

test("input validation preserves text literally and rejects oversized or non-text prompts", () => {
  const prompt = '<img src=x onerror="alert(1)">';
  assert.equal(createDraft({ modelId: "demo-flux", templateId: "text-to-image", prompt }).prompt, prompt);
  for (const invalid of ["x".repeat(6001), 123, null]) {
    assert.throws(() => createDraft({ modelId: "demo-flux", templateId: "text-to-image", prompt: invalid }));
  }
});

test("exported drafts do not contain account identity or mutate the fixture dependencies", () => {
  const draft = createDraft({ modelId: "demo-flux", templateId: "text-to-image" });
  draft.dependencies.push("changed");
  const next = createDraft({ modelId: "demo-flux", templateId: "text-to-image" });
  assert.ok(!next.dependencies.includes("changed"));
  assert.ok(!Object.hasOwn(next, "userId"));
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});
