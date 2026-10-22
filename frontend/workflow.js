(function (root) {
  "use strict";
  const catalog = typeof module !== "undefined" && module.exports ? require("./catalog.js") : root.MainStudioCatalog;

  function getModel(id) {
    const model = catalog.models.find(item => item.id === id);
    if (!model) throw new Error("선택한 모델을 찾을 수 없습니다.");
    return model;
  }
  function getTemplate(model, id) {
    const template = model.templates.find(item => item.id === id);
    if (!template) throw new Error("이 모델에 연결된 워크플로우가 아닙니다.");
    return template;
  }
  function normalizeSettings(template, supplied = {}) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("설정 형식이 올바르지 않습니다.");
    const keys = new Set(template.settings.map(item => item.key));
    if (Object.keys(supplied).some(key => !keys.has(key))) throw new Error("지원하지 않는 설정이 포함되어 있습니다.");
    return Object.fromEntries(template.settings.map(field => {
      const value = Object.hasOwn(supplied, field.key) ? supplied[field.key] : field.defaultValue;
      if (!field.options.some(option => option.value === value)) throw new Error("허용되지 않은 설정값입니다.");
      return [field.key, value];
    }));
  }
  function makeGraph(model, template, prompt, settings) {
    const node = (id, title, icon, tone, x, y, lines, detail, extra = {}) => ({ id, title, icon, tone, x, y, width: 190, height: 106, lines, detail, ...extra });
    const previewText = prompt.trim() ? prompt.trim().slice(0, 42) + (prompt.trim().length > 42 ? "…" : "") : "아이디어를 입력해 보세요";
    const textMode = ["llm", "embedding"].includes(template.graphKind);
    const reference = template.graphKind.endsWith("-reference");
    const video = template.graphKind.startsWith("video");
    const nodes = [
      node("model", textMode ? "실행 모델" : "모델 & 인코더", model.icon, "purple", 40, reference ? 18 : 78, [model.name + " · 샘플", model.dependencies.join(" / ")], "선택한 모델과 필요한 구성 요소입니다. 실제 파일·버전·로더는 서버가 확인합니다.", { source: true }),
      node("input", template.graphKind === "embedding" ? "입력 텍스트" : "프롬프트", "text", "blue", 40, reference ? 163 : 253, [previewText, textMode ? "텍스트 입력" : "텍스트 인코딩"], "작업에 전달할 입력 내용입니다. 입력 문장은 이 미리보기에서 서버로 전송되지 않습니다.", { source: true })
    ];
    const edges = [{ from: "model", to: "process", tone: "purple" }, { from: "input", to: "process", tone: "blue" }];
    if (reference) {
      nodes.push(node("reference", video ? "시작 이미지" : "참조 이미지", "image", "amber", 40, 308, ["업로드 연결 예정", "원본 자산 ID 사용"], "서버 연결 후 공유 저장소의 이미지 또는 업로드한 자산을 연결할 위치입니다.", { source: true }));
      edges.push({ from: "reference", to: "process", tone: "amber" });
    }
    if (textMode) {
      const embedding = template.graphKind === "embedding";
      nodes.push(node("process", embedding ? "임베딩 변환" : "텍스트 생성", "node", "purple", 330, 163, [embedding ? "텍스트 → 벡터" : "모델 추론 어댑터", "메인의 작업 대기열 연결 예정"], "실제 실행 시 GPU 스케줄러를 거쳐 모델 실행기에 연결할 단계입니다.", { width: 210, height: 125 }));
      nodes.push(node("output", embedding ? "벡터 결과" : "텍스트 결과", "folder", "green", 650, 163, [embedding ? "벡터 데이터 · JSON" : "생성 텍스트", "팀 공유 저장소 연결 예정"], "실제 생성 결과를 저장하고 다시 열어볼 단계입니다. 현재는 결과를 생성하지 않습니다.", { output: true }));
      edges.push({ from: "process", to: "output", tone: "green" });
    } else {
      nodes.push(node("process", video ? "영상 샘플러" : "이미지 샘플러", "sliders", "purple", 330, 148, ["화면 비율  " + settings.aspect, "프리셋  " + (settings.quality === "detail" ? "디테일 중심" : settings.quality === "draft" ? "빠른 구상" : video ? "영상 기본" : "기본"), "시드  실행 시 설정"], "샘플러의 실제 클래스·해상도·스텝·지원 정밀도는 모델별 템플릿과 서버 검증 결과로 정합니다.", { width: 210, height: 150 }));
      nodes.push(node("decode", video ? "영상 VAE 디코드" : "VAE 디코드", "image", "amber", 650, 78, ["잠재 표현 → " + (video ? "프레임" : "이미지"), "호환 VAE 연결 예정"], "모델에 맞는 VAE로 잠재 표현을 출력 데이터로 바꾸는 개념 단계입니다."));
      nodes.push(node("output", video ? "영상 저장" : "이미지 저장", "folder", "green", 650, 270, [video ? "영상 파일" : "이미지 파일", "프로젝트 / 작업별 저장 예정"], "생성 결과를 메인의 저장소에 저장하고 브라우저에 표시할 단계입니다.", { output: true }));
      edges.push({ from: "process", to: "decode", tone: "purple" }, { from: "decode", to: "output", tone: "green" });
    }
    return { width: 900, height: 440, nodes, edges };
  }
  function createDraft({ modelId, templateId, prompt = "", settings = {} }) {
    const model = getModel(modelId);
    const template = getTemplate(model, templateId);
    if (typeof prompt !== "string" || prompt.length > 6000) throw new Error("입력 내용은 6,000자 이내의 텍스트여야 합니다.");
    const normalized = normalizeSettings(template, settings);
    return {
      schema: "main.studio.workflow-draft.v1", demo: true, executable: false,
      compatibility: "unverified", catalogVersion: catalog.version,
      model: { id: model.id, name: model.name, runtime: model.runtime },
      template: { id: template.id, name: template.label }, prompt,
      settings: normalized, dependencies: [...model.dependencies],
      graph: makeGraph(model, template, prompt, normalized)
    };
  }
  function filterModels(category, query) {
    const term = String(query || "").trim().toLocaleLowerCase();
    return catalog.models.filter(model => (category === "all" || model.category === category) &&
      [model.name, model.family, model.categoryLabel, ...model.tags].join(" ").toLocaleLowerCase().includes(term));
  }
  const api = { getModel, getTemplate, normalizeSettings, createDraft, filterModels };
  root.MainStudioWorkflow = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
