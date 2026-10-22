(function () {
  "use strict";
  const catalog = window.MainStudioCatalog;
  const workflow = window.MainStudioWorkflow;
  const $ = id => document.getElementById(id);
  const state = { modelId: catalog.models[0].id, templateId: catalog.models[0].templates[0].id, category: "all", query: "", zoom: 1, selectedNode: null, drafts: new Map(), graph: null };
  const storageKey = "main-studio:design-selection:v1";
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved) {
      const model = workflow.getModel(saved.modelId);
      const template = workflow.getTemplate(model, saved.templateId);
      state.modelId = model.id;
      state.templateId = template.id;
    }
  } catch (_) { /* Unavailable storage or stale fixture selection: use the defaults. */ }

  function el(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#i-" + name);
    svg.append(use);
    return svg;
  }
  function announce(message) { $("announcement").textContent = message; }
  function model() { return workflow.getModel(state.modelId); }
  function template() { return workflow.getTemplate(model(), state.templateId); }
  function draftKey() { return state.modelId + ":" + state.templateId; }
  function currentInputs() {
    return { prompt: $("prompt-input").value, settings: Object.fromEntries([...$("workflow-settings").querySelectorAll("select")].map(select => [select.name, select.value])) };
  }
  function rememberDraft() { state.drafts.set(draftKey(), currentInputs()); }
  function rememberSelection() {
    try { localStorage.setItem(storageKey, JSON.stringify({ modelId: state.modelId, templateId: state.templateId })); } catch (_) { /* File previews can deny localStorage. */ }
  }

  function renderCategories() {
    $("category-filters").replaceChildren(...catalog.categories.map(category => {
      const button = el("button", "filter-button", category.label);
      button.type = "button";
      button.dataset.category = category.id;
      button.setAttribute("aria-pressed", String(category.id === state.category));
      button.addEventListener("click", event => {
        state.category = category.id;
        const matches = workflow.filterModels(state.category, state.query);
        if (category.id !== "all" && model().category !== category.id && matches.length) selectModel(matches[0].id);
        renderCategories();
        renderList();
        if (event.detail === 0) $("category-filters").querySelector(`[data-category="${category.id}"]`).focus();
      });
      return button;
    }));
  }
  function renderList() {
    const matches = workflow.filterModels(state.category, state.query);
    $("model-total").textContent = String(catalog.models.length).padStart(2, "0");
    $("result-count").textContent = matches.length + " MODELS";
    $("filter-label").textContent = state.category === "all" ? "모든 모델" : catalog.categories.find(category => category.id === state.category).label + " 모델";
    $("model-list").replaceChildren(...matches.map(item => {
      const button = el("button", "model-card");
      button.type = "button";
      button.dataset.modelId = item.id;
      button.setAttribute("aria-pressed", String(item.id === state.modelId));
      const art = el("span", "model-art");
      art.dataset.tone = item.tone;
      art.append(icon(item.icon));
      const copy = el("span", "model-copy");
      copy.append(el("span", "model-title", item.name), el("span", "model-subtitle", item.family));
      const tags = el("span", "model-tags");
      tags.append(...item.tags.map(tag => el("span", "model-tag", tag)));
      copy.append(tags);
      const indicator = el("span", "selection-indicator");
      indicator.setAttribute("aria-hidden", "true");
      indicator.append(icon("check"));
      button.append(art, copy, indicator);
      button.addEventListener("click", event => {
        selectModel(item.id);
        if (event.detail === 0) $("model-list").querySelector(`[data-model-id="${item.id}"]`).focus();
      });
      return button;
    }));
    $("empty-state").hidden = matches.length > 0;
  }
  function selectModel(id) {
    if (id === state.modelId) return;
    rememberDraft();
    state.modelId = id;
    state.templateId = model().templates[0].id;
    state.zoom = 1;
    state.selectedNode = null;
    rememberSelection();
    renderList();
    renderWorkflow();
    announce(model().name + " 모델과 관련 워크플로우를 선택했습니다.");
  }
  function renderWorkflow() {
    const selected = model();
    const selectedTemplate = template();
    $("selected-model-label").textContent = selected.name + " / " + selected.categoryLabel;
    $("template-title").textContent = selectedTemplate.title;
    $("template-description").textContent = selectedTemplate.description;
    $("selected-kind").textContent = selected.categoryLabel;
    $("template-options").replaceChildren(...selected.templates.map(item => {
      const button = el("button", "template-button", item.label);
      button.type = "button";
      button.dataset.templateId = item.id;
      button.setAttribute("aria-pressed", String(item.id === state.templateId));
      button.addEventListener("click", event => {
        rememberDraft();
        state.templateId = item.id;
        state.selectedNode = null;
        state.zoom = 1;
        rememberSelection();
        renderWorkflow();
        if (event.detail === 0) $("template-options").querySelector(`[data-template-id="${item.id}"]`).focus();
        announce(item.label + " 구성을 선택했습니다.");
      });
      return button;
    }));
    const saved = state.drafts.get(draftKey()) || { prompt: "", settings: {} };
    $("prompt-label").textContent = selectedTemplate.promptLabel;
    $("prompt-input").placeholder = selectedTemplate.placeholder;
    $("prompt-input").value = saved.prompt;
    $("workflow-settings").replaceChildren(...selectedTemplate.settings.map(field => {
      const wrapper = el("div", "setting-field");
      const label = el("label", "", field.label);
      label.htmlFor = "setting-" + field.key;
      const select = el("select");
      select.id = label.htmlFor;
      select.name = field.key;
      select.append(...field.options.map(choice => {
        const option = el("option", "", choice.label);
        option.value = choice.value;
        return option;
      }));
      select.value = saved.settings[field.key] || field.defaultValue;
      select.addEventListener("change", () => { rememberDraft(); renderGraph(); });
      wrapper.append(label, select);
      return wrapper;
    }));
    renderGraph();
  }

  function renderGraph() {
    const draft = workflow.createDraft({ modelId: state.modelId, templateId: state.templateId, ...currentInputs() });
    state.graph = draft.graph;
    $("graph-count").textContent = draft.graph.nodes.length + "개 노드 · " + draft.graph.edges.length + "개 연결";
    $("graph-nodes").replaceChildren(...draft.graph.nodes.map(node => {
      const button = el("button", "graph-node");
      button.type = "button";
      button.dataset.nodeId = node.id;
      button.dataset.tone = node.tone;
      button.dataset.source = Boolean(node.source);
      button.dataset.output = Boolean(node.output);
      button.dataset.verticalIn = draft.graph.edges.some(edge => edge.to === node.id && draft.graph.nodes.find(item => item.id === edge.from).x === node.x);
      button.dataset.verticalOut = draft.graph.edges.some(edge => edge.from === node.id && draft.graph.nodes.find(item => item.id === edge.to).x === node.x);
      button.style.left = node.x + "px";
      button.style.top = node.y + "px";
      button.style.width = node.width + "px";
      button.style.minHeight = node.height + "px";
      button.setAttribute("aria-pressed", String(state.selectedNode === node.id));
      button.setAttribute("aria-label", node.title + ": " + node.lines.join(", "));
      const header = el("span", "node-header");
      header.append(icon(node.icon), el("span", "", node.title));
      const body = el("span", "node-body");
      node.lines.forEach((line, index) => body.append(el("span", index === 0 ? "node-value" : "", line)));
      button.append(header, body);
      button.addEventListener("click", () => {
        state.selectedNode = node.id;
        $("graph-nodes").querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
        $("node-detail-text").textContent = node.title + " — " + node.detail;
      });
      return button;
    }));
    $("graph-wires").replaceChildren(...draft.graph.edges.map(edge => {
      const from = draft.graph.nodes.find(node => node.id === edge.from);
      const to = draft.graph.nodes.find(node => node.id === edge.to);
      const vertical = from.x === to.x;
      const startX = vertical ? from.x + from.width / 2 : from.x + from.width;
      const startY = vertical ? from.y + from.height : from.y + 29;
      const endX = vertical ? to.x + to.width / 2 : to.x;
      const endY = vertical ? to.y : to.y + 29;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("graph-wire");
      path.dataset.tone = edge.tone;
      const middle = (startX + endX) / 2;
      path.setAttribute("d", vertical ? `M ${startX} ${startY} C ${startX} ${startY + 35}, ${endX} ${endY - 35}, ${endX} ${endY}` : `M ${startX} ${startY} C ${middle} ${startY}, ${middle} ${endY}, ${endX} ${endY}`);
      return path;
    }));
    const node = draft.graph.nodes.find(item => item.id === state.selectedNode);
    $("node-detail-text").textContent = node ? node.title + " — " + node.detail : model().dependencies.join(" · ") + " 등 모델별 구성 요소를 연결하는 샘플입니다.";
    resizeGraph();
  }
  function resizeGraph() {
    if (!state.graph) return;
    const viewport = $("graph-viewport");
    const fit = Math.min((viewport.clientWidth - 32) / state.graph.width, (viewport.clientHeight - 22) / state.graph.height, 1);
    const scale = Math.max(.4, Math.min(1.75, fit * state.zoom));
    const width = Math.max(viewport.clientWidth, state.graph.width * scale + 32);
    const height = Math.max(viewport.clientHeight, state.graph.height * scale + 22);
    $("graph-surface").style.width = width + "px";
    $("graph-surface").style.height = height + "px";
    $("graph-stage").style.transform = `translate(${(width - state.graph.width * scale) / 2}px, ${(height - state.graph.height * scale) / 2}px) scale(${scale})`;
    $("zoom-label").textContent = Math.round(scale * 100) + "%";
    $("zoom-out").disabled = state.zoom <= .65;
    $("zoom-in").disabled = state.zoom >= 2;
  }

  function openDialog(children) {
    $("dialog-content").replaceChildren(...children);
    $("studio-dialog").showModal();
  }
  function dialogTitle(text, artIcon = "spark") {
    const art = el("div", "dialog-art");
    art.append(icon(artIcon));
    const title = el("h2", "", text);
    title.id = "dialog-title";
    return [art, title];
  }
  function downloadDraft(draft, status) {
    const blob = new Blob([JSON.stringify(draft, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = el("a");
    anchor.href = url;
    anchor.download = "main-studio-" + draft.model.id + "-" + draft.template.id + ".json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "설정 JSON 다운로드를 요청했습니다. 이 파일은 실행용 ComfyUI 그래프가 아닌 시안 설정입니다.";
    announce("워크플로우 시안 설정 JSON 다운로드를 요청했습니다.");
  }
  function prepare(event) {
    event.preventDefault();
    rememberDraft();
    const draft = workflow.createDraft({ modelId: state.modelId, templateId: state.templateId, ...currentInputs() });
    const summary = el("div", "dialog-summary");
    const rows = [["선택한 모델", draft.model.name], ["워크플로우", draft.template.name], ["연결 구성", draft.graph.nodes.length + "개 노드"], ["상태", "샘플 · 실행 전 검증 필요"]];
    rows.forEach(([key, value]) => { const row = el("div"); row.append(el("span", "", key), el("strong", "", value)); summary.append(row); });
    const actions = el("div", "dialog-actions");
    const back = el("button", "secondary-button", "계속 편집");
    back.type = "button";
    back.addEventListener("click", () => $("studio-dialog").close());
    const download = el("button", "primary-button");
    download.type = "button";
    download.append(icon("download"), document.createTextNode("설정 JSON 저장"));
    const status = el("p", "dialog-smallprint", "현재는 프런트엔드 시안입니다. 로그인, 실제 모델 호환성 검증, ComfyUI 편집기 전달과 GPU 실행은 백엔드 연결 후 제공됩니다.");
    status.setAttribute("role", "status");
    download.addEventListener("click", () => downloadDraft(draft, status));
    actions.append(back, download);
    openDialog([...dialogTitle("워크플로우 구성을 준비했어요"), el("p", "dialog-description", "선택한 모델과 입력 설정을 한곳에 모았어요. 계속 다듬거나 설정 파일로 저장할 수 있습니다."), summary, actions, status]);
  }
  $("help-button").addEventListener("click", () => {
    const list = el("ol", "help-list");
    ["모델과 작업 종류를 선택하세요.", "관련 워크플로우를 고르고 노드 구성을 확인하세요.", "입력과 설정을 다듬고 워크플로우 준비를 누르세요."].forEach(text => list.append(el("li", "", text)));
    openDialog([...dialogTitle("모델에서 워크플로우까지", "help"), el("p", "dialog-description", "로그인 후 사용할 모델 선택 화면의 시안입니다. 샘플 데이터만 사용하며 생성 작업이나 서버 요청은 하지 않습니다."), list, el("p", "dialog-smallprint", "설정 JSON은 시안용 연결 구성입니다. 실제 ComfyUI 실행용 workflow와 모델별 호환성 검증은 서버 통합 단계에 연결합니다. 입력 내용은 서버에 전송하거나 영구 저장하지 않습니다.")]);
  });
  $("close-dialog").addEventListener("click", () => $("studio-dialog").close());
  $("studio-dialog").addEventListener("click", event => {
    const rect = $("studio-dialog").getBoundingClientRect();
    if (event.target === $("studio-dialog") && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $("studio-dialog").close();
  });
  $("model-search").addEventListener("input", event => { state.query = event.target.value; renderList(); });
  $("clear-search").addEventListener("click", () => { state.query = ""; state.category = "all"; $("model-search").value = ""; renderCategories(); renderList(); $("model-search").focus(); });
  let promptTimer;
  $("prompt-input").addEventListener("input", () => { rememberDraft(); clearTimeout(promptTimer); promptTimer = setTimeout(renderGraph, 100); });
  $("workflow-form").addEventListener("submit", prepare);
  $("zoom-in").addEventListener("click", () => { state.zoom = Math.min(2, state.zoom + .2); resizeGraph(); });
  $("zoom-out").addEventListener("click", () => { state.zoom = Math.max(.65, state.zoom - .2); resizeGraph(); });
  $("zoom-fit").addEventListener("click", () => { state.zoom = 1; resizeGraph(); $("graph-viewport").scrollTo(0, 0); });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !$("studio-dialog").open && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      event.preventDefault();
      $("model-search").focus();
    }
  });
  renderCategories();
  renderList();
  renderWorkflow();
  if (window.ResizeObserver) new ResizeObserver(resizeGraph).observe($("graph-viewport"));
  else window.addEventListener("resize", resizeGraph);
})();
