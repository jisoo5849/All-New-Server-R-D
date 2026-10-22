# 공식 참고 자료

확인일: 2026-10-22. 공식 문서와 현재 소스를 참고하여 작성한 설계입니다. `latest`, `stable`, `master` URL의 내용은 바뀔 수 있으므로 구현 시 실제 사용할 버전과 commit을 고정해 다시 검증합니다. 프로그램이 제공하는 기능과 이 저장소에서 직접 개발할 기능은 각 문서에서 구분했습니다.

| 자료 | 설계에서 참고한 범위 |
| --- | --- |
| [ComfyUI 클라이언트·서버 및 커스텀 노드 구조](https://docs.comfy.org/custom-nodes/overview) | 원래 편집기 유지와 프런트엔드 통신 호환성 |
| [ComfyUI 서버 API](https://docs.comfy.org/development/comfyui-server/comms_routes) | prompt·queue·history·업로드·모델 목록 등 경로 |
| [ComfyUI WebSocket 이벤트](https://docs.comfy.org/development/comfyui-server/comms_messages) | 실행 이벤트와 프런트엔드 전달 |
| [ComfyUI 실행 옵션](https://docs.comfy.org/development/comfyui-server/startup-flags) | LAN·입출력·모델·사용자 폴더 설정 |
| [ComfyUI 수동 설치와 추가 모델 경로](https://docs.comfy.org/installation/manual_install) | 실행 환경 의존성과 공용 모델 경로 |
| [ComfyUI 커스텀 노드 관리](https://docs.comfy.org/basic-concepts/custom-nodes) | 노드·의존성 설치·환경 분리 필요성 |
| [ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager) | 노드 관리와 버전별 설치 허용 정책 |
| [ComfyUI server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py) | prompt UUID 처리 및 실제 경로 계약 확인 지점 |
| [Keycloak 컨테이너](https://www.keycloak.org/server/containers) | 컨테이너 운영 구성 |
| [Keycloak DB](https://www.keycloak.org/server/db) | PostgreSQL 지원과 인증 DB 분리 |
| [Keycloak reverse proxy](https://www.keycloak.org/server/reverseproxy) | 공개 origin·프록시 헤더·TLS 구성 |
| [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html) | 인증 이벤트 수집 API |
| [Keycloak Server Developer Guide](https://www.keycloak.org/docs/latest/server_development/index.html) | 필요 시 Event Listener SPI 확장 |
| [PostgreSQL JSON](https://www.postgresql.org/docs/current/datatype-json.html) | workflow·옵션의 jsonb 저장 |
| [PostgreSQL 잠금](https://www.postgresql.org/docs/current/explicit-locking.html) | GPU 예약·상태 전이 트랜잭션 |
| [Celery 최적화](https://docs.celeryq.dev/en/stable/userguide/optimizing.html) | worker 동시성·prefetch·late acknowledgment |
| [Celery Redis](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html) | visibility timeout과 긴 작업의 재전달 |
| [Celery 설정](https://docs.celeryq.dev/en/stable/userguide/configuration.html) | worker 종료·재전달·연결 장애 정책 |
| [Ollama 모델 목록](https://docs.ollama.com/api/tags) | 설치 모델 목록 연동 |
| [Ollama 텍스트 임베딩](https://docs.ollama.com/api/embed) | 텍스트 임베딩 실행 어댑터 |
| [Ollama FAQ](https://docs.ollama.com/faq) | 모델 메모리 유지·해제와 동시성 정책 |
| [Docker Compose GPU](https://docs.docker.com/compose/how-tos/gpu-support/) | 컨테이너별 GPU 장치 연결 |
| [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) | 호스트 드라이버·컨테이너 런타임 연결 |
| [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) | HTTPS 진입점과 HTTP/WS 전달 |

전역 GPU lease, 사용자별 round-robin, ComfyUI 호환 게이트웨이, 모델 카탈로그, 모델별 실행 추적, 공유 갤러리와 DB 논리 스키마는 이 프로젝트의 **제안 설계**입니다. 위 프로그램이 이 조합을 완제품으로 제공한다는 의미가 아닙니다.
