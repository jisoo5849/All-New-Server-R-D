(function (root) {
  "use strict";
  // Design fixtures only. This is not the server's installed-model registry.
  const categories = [
    { id: "all", label: "전체" }, { id: "image", label: "이미지" },
    { id: "video", label: "영상" }, { id: "llm", label: "텍스트" },
    { id: "embedding", label: "임베딩" }
  ];
  const choice = (key, label, values, defaultValue) => ({
    key, label, defaultValue, options: values.map(([value, text]) => ({ value, label: text }))
  });
  const imageSettings = () => [
    choice("aspect", "화면 비율", [["1:1", "1:1 · 정사각형"], ["3:4", "3:4 · 세로"], ["4:3", "4:3 · 가로"], ["16:9", "16:9 · 와이드"]], "3:4"),
    choice("quality", "프리셋", [["draft", "빠른 구상"], ["standard", "기본"], ["detail", "디테일 중심"]], "standard")
  ];
  const imageTemplates = () => [
    { id: "text-to-image", label: "텍스트 → 이미지", title: "한 문장에서 시작하는 이미지", description: "모델과 텍스트 입력을 연결한, 이미지 작업의 기본 구성입니다.", promptLabel: "어떤 이미지를 만들까요?", placeholder: "부드러운 오후 햇살, 커다란 창가에 놓인 초록 식물과 조용한 작업실…", graphKind: "image", settings: imageSettings() },
    { id: "image-to-image", label: "이미지 → 이미지", title: "이미지를 새로운 분위기로", description: "참조 이미지 입력을 추가한 구성입니다. 파일 업로드는 서버 연결 후 제공됩니다.", promptLabel: "어떤 분위기로 바꿀까요?", placeholder: "참조 이미지의 구도는 유지하고, 따뜻한 필름 사진의 분위기로…", graphKind: "image-reference", settings: imageSettings() }
  ];
  const models = [
    { id: "demo-flux", name: "FLUX.1", family: "FLUX · Image generation", category: "image", categoryLabel: "이미지 생성", icon: "image", tone: "purple", tags: ["이미지", "텍스트 기반"], runtime: "comfyui", dependencies: ["모델 로더", "텍스트 인코더", "VAE"], templates: imageTemplates() },
    { id: "demo-sdxl", name: "SDXL", family: "Stable Diffusion · Image", category: "image", categoryLabel: "이미지 생성", icon: "image", tone: "rose", tags: ["이미지", "기본 구성"], runtime: "comfyui", dependencies: ["체크포인트", "텍스트 인코더", "VAE"], templates: imageTemplates() },
    { id: "demo-wan", name: "Wan", family: "Wan · Video generation", category: "video", categoryLabel: "영상 생성", icon: "video", tone: "blue", tags: ["영상", "텍스트 기반"], runtime: "comfyui", dependencies: ["영상 모델", "텍스트 인코더", "영상 VAE"], templates: [
      { id: "text-to-video", label: "텍스트 → 영상", title: "움직임이 있는 아이디어", description: "장면 설명에서 영상 출력까지 이어지는 샘플 구성입니다.", promptLabel: "어떤 장면을 만들까요?", placeholder: "바람에 천천히 흔들리는 커튼, 창문 사이로 들어오는 빛, 고정된 카메라…", graphKind: "video", settings: [choice("aspect", "화면 비율", [["16:9", "16:9 · 가로"], ["9:16", "9:16 · 세로"]], "16:9"), choice("duration", "목표 길이", [["short", "짧은 클립"], ["medium", "중간 클립"]], "short")] },
      { id: "image-to-video", label: "이미지 → 영상", title: "한 장의 이미지에 움직임을", description: "시작 이미지 입력을 추가합니다. 실제 지원 여부는 서버에서 검증합니다.", promptLabel: "어떤 움직임을 더할까요?", placeholder: "시작 이미지의 분위기를 유지하며 카메라가 천천히 앞으로 이동…", graphKind: "video-reference", settings: [choice("aspect", "화면 비율", [["16:9", "16:9 · 가로"], ["9:16", "9:16 · 세로"]], "16:9"), choice("duration", "목표 길이", [["short", "짧은 클립"], ["medium", "중간 클립"]], "short")] }
    ] },
    { id: "demo-qwen", name: "Qwen", family: "Qwen · Language model", category: "llm", categoryLabel: "텍스트 생성", icon: "text", tone: "green", tags: ["LLM", "텍스트"], runtime: "ollama", dependencies: ["LLM 어댑터", "모델 manifest"], templates: [
      { id: "text-generation", label: "텍스트 생성", title: "생각을 문장으로 이어가기", description: "입력 내용과 모델을 연결해 텍스트를 작성하는 구성입니다.", promptLabel: "어떤 도움이 필요한가요?", placeholder: "새로운 브랜드의 소개 문구를 세 가지 방향으로 제안해 줘…", graphKind: "llm", settings: [choice("style", "문장 스타일", [["balanced", "균형 있게"], ["creative", "창의적으로"], ["concise", "간결하게"]], "balanced")] },
      { id: "prompt-writing", label: "프롬프트 작성", title: "이미지의 출발점을 문장으로", description: "아이디어를 이미지용 프롬프트로 정리하는 샘플 구성입니다.", promptLabel: "만들고 싶은 장면을 알려주세요", placeholder: "비 온 뒤의 골목길, 젖은 아스팔트에 반사된 네온사인…", graphKind: "llm", settings: [choice("style", "문장 스타일", [["balanced", "균형 있게"], ["creative", "창의적으로"], ["concise", "간결하게"]], "creative")] }
    ] },
    { id: "demo-bge", name: "BGE", family: "BGE · Text embedding", category: "embedding", categoryLabel: "텍스트 임베딩", icon: "vector", tone: "amber", tags: ["임베딩", "텍스트 벡터"], runtime: "embedding-adapter", dependencies: ["텍스트 임베딩 어댑터", "모델 manifest"], templates: [
      { id: "text-embedding", label: "텍스트 → 벡터", title: "문장의 의미를 연결하기", description: "텍스트를 벡터로 변환하는 구성입니다. 이미지용 임베딩과 구분됩니다.", promptLabel: "벡터로 변환할 텍스트", placeholder: "의미를 비교하거나 검색하고 싶은 문장을 입력하세요…", graphKind: "embedding", settings: [choice("inputMode", "입력 용도", [["document", "문서"], ["query", "검색 문장"]], "document")] }
    ] }
  ];
  const catalog = { version: "design-fixture-v1", categories, models };
  root.MainStudioCatalog = catalog;
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(globalThis);
