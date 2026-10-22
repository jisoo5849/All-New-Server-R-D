# Docker 구성, 개발 순서와 검증 기준

> 이 문서는 향후 개발·배포 절차입니다. 이번 변경에서는 프로그램 설치, 이미지 빌드, 모델 다운로드, DB 생성, Docker 서비스 실행을 하지 않습니다.

## 1. 개발 범위 구분

| 분류 | 항목 |
| --- | --- |
| 기존 프로그램을 설정하여 사용 | Docker, NVIDIA Container Toolkit, PostgreSQL, Redis, Keycloak, Caddy, ComfyUI, Manager, Ollama |
| 직접 개발 | 포털, 모델 카탈로그·호환 템플릿 선택, OIDC BFF, ComfyUI Gateway, GPU Dispatcher / Execution Agent, 모델 추적 어댑터, 감사 수집, 공유 갤러리 |
| 단계적으로 추가 | 다른 모델 실행기, 개인별 환경, 선택적 Samba, 다중 GPU·다중 서버 |

단순히 ComfyUI에 로그인 프록시만 붙이면 사용자별 실제 모델 사용 이력이나 전역 GPU 배분은 해결되지 않습니다. 이 프로젝트의 주요 개발 범위는 위의 직접 개발 계층입니다.

## 2. 필요한 프로그램과 선정 이유

| 프로그램 | 용도·선정 이유 | 초기 필수 여부 |
| --- | --- | --- |
| Ubuntu + NVIDIA 드라이버 | 실제 GPU 실행 호스트 | 필수 |
| Docker Engine + Compose 플러그인 | 여러 서비스의 구성·네트워크·영속 볼륨 관리 | 필수 |
| NVIDIA Container Toolkit | 컨테이너의 NVIDIA GPU 접근 | 필수 |
| PostgreSQL | 계정 연결·모델·작업·감사 데이터, 트랜잭션·관계·JSON | 필수 |
| Redis | Celery 브로커와 임시 실시간 메시지 | 필수 |
| Keycloak | 계정·역할·OIDC 로그인과 인증 이벤트 | 필수 |
| Python + FastAPI + Authlib | 서버 API·인증 세션·프록시·이벤트 처리 | 필수 |
| SQLAlchemy + Alembic | DB 접근과 migration | 필수 |
| Celery | GPU/CPU 작업 worker 기반 | 필수 |
| ComfyUI + ComfyUI-Manager | 원래 워크플로우 편집·실행 및 노드 관리 | 필수 |
| Ollama | 지원하는 LLM·텍스트 임베딩 실행 | 해당 기능 단계부터 |
| React + TypeScript + Vite | 포털·모델 선택·갤러리·관리자 화면 | 필수 |
| Caddy | HTTPS, 호스트별 라우팅, WebSocket 전달 | 필수 |
| FFmpeg | 영상 처리·썸네일·노드 의존성 | 영상 단계부터 |
| NVML Python 바인딩 | GPU 상태·메모리·프로세스 관측 | 필수 |
| Prometheus + Grafana | GPU·대기열·오류 추이 운영 대시보드 | 운영 확대 시 선택 |

라이브러리·이미지의 정확한 버전은 GPU 호환성 검증 후 잠금 파일과 image digest로 고정합니다. 기본 운영 배포에서 `latest` 또는 개발용 Keycloak 실행 모드를 사용하지 않습니다. 기존 호스트 드라이버를 확인하고 변경 필요성이 검증되지 않은 상태에서 자동 교체하지 않습니다.

## 3. 향후 구현할 저장소 구조

```text
apps/portal/                    # 모델 카탈로그, 갤러리, 이력 화면
services/api/                   # FastAPI BFF, 사용자 API
services/comfy-gateway/         # HTTP/WS 및 ID 호환 계층
services/dispatcher/            # 공정 배분, lease, outbox와 복구
services/execution-agent/       # 실행기 제어, heartbeat와 로컬 저널
services/workers/               # Celery GPU/CPU task
extensions/comfy-portal/        # 카탈로그 연결과 전역 큐 패널
adapters/model-tracing/         # 로더·모델 실행 추적
adapters/runtimes/              # ComfyUI, Ollama, 추가 실행기
db/migrations/                 # Alembic migration
infra/compose/                 # compose.yaml과 환경별 override
infra/images/                  # 버전 고정한 서비스·실행기 Dockerfile
infra/keycloak/                # 비밀값 없는 realm/client 구성
tests/contracts/               # ComfyUI 버전별 HTTP/WS 계약
tests/integration/              # 로그인·작업·복구·공유 파일 검증
docs/                          # 현재 설계 문서
```

현재는 README와 `docs/`의 설계 문서, `frontend/`의 순수 HTML·CSS·JavaScript 시안이 작성되어 있습니다. 위의 서비스·DB·배포 경로는 구현 예정이며 현재 실행 코드로 오해하지 않도록 구분합니다. 시안의 샘플 그래프는 실제 ComfyUI 실행 graph가 아닙니다.

## 4. Compose 서비스 구성

| 서비스 | 연결 대상 | 영속 데이터 | 호스트 포트 공개 |
| --- | --- | --- | --- |
| `edge` | portal, API, gateway, Keycloak | 인증서·접근 로그 스풀 | HTTPS, 필요 시 HTTP 리다이렉트만 |
| `portal` | 브라우저용 정적 파일 | 없음 | 없음 |
| `api` | Keycloak, 서비스 DB, 자산 저장소 | 보호된 세션·설정 | 없음 |
| `comfy-gateway` | API, DB, 지정 환경의 ComfyUI | 연결·이벤트 상태 | 없음 |
| `keycloak` | 인증 DB | realm·계정은 PostgreSQL | edge 경유 로그인만 |
| `postgres` | 허용된 서비스 | DB 볼륨 | 없음 |
| `redis` | Dispatcher, workers, 알림 서비스 | AOF 볼륨 | 없음 |
| `dispatcher` | DB, Redis, Agent | DB 원장 | 없음 |
| `gpu-worker` | DB, Redis, Agent | 실행 시도 기록 | 없음 |
| `cpu-worker` | DB, Redis, 파일 저장소 | 작업별 임시 데이터 | 없음 |
| `execution-agent` | 지정 실행기, 제한된 환경 관리 API | 실행 의도·상태 로컬 저널 | 없음 |
| `comfy-*` | gateway, 내부 추론 어댑터, 모델·공유 파일 | revision별 설정·입출력 | 없음 |
| `ollama` | 내부 추론 어댑터 | 모델 볼륨 | 없음 |

인증·DB·브로커 네트워크와 모델 실행기 네트워크를 분리합니다. 커스텀 노드 컨테이너가 PostgreSQL, Redis, Keycloak 관리자 API에 접근하지 못하도록 네트워크·자격 증명을 제한합니다. 인터넷 다운로드가 필요한 환경은 필요한 egress만 별도로 열어 모델 실행기의 내부 통제망 우회를 막습니다.

GPU는 실제 추론 서비스에만 할당하고 종류별로 host GPU UUID와 컨테이너 device mapping을 연결합니다. Compose GPU 예약은 GPU 사용 가능 장치 지정이며 메모리 쿼터나 스케줄러가 아닙니다. [Docker GPU Compose 문서](https://docs.docker.com/compose/how-tos/gpu-support/)

환경 생성은 제한된 관리 에이전트만 수행합니다. API·worker·커스텀 노드 컨테이너에 raw Docker socket을 공유하지 않습니다. 관리 에이전트가 호스트 runtime 제어 권한을 사용하는 경우 고정된 이미지·마운트·네트워크·명령만 허용하는 좁은 인터페이스를 둡니다.

## 5. 설정과 영속화

- 공개 저장소에는 비밀값 없는 예제 설정만 두고 실제 `.env`, 쿠키 키, OIDC client secret, DB 비밀번호, API 키는 제외합니다.
- Compose secrets 또는 권한을 제한한 호스트 파일로 비밀값을 주입합니다. 로컬 Compose secret 파일 자체가 암호화 저장소인 것은 아닙니다.
- 데이터 루트, 공개 origin, OIDC issuer, GPU UUID, 제한 시간, 로그 보존 기간, 큐 상한을 환경 변수 또는 관리 설정으로 분리합니다.
- 서비스별 healthcheck, 의존 서비스 readiness, 재시작 정책, 정상 종료 유예시간, 로그 rotation을 설정합니다.
- DB migration은 단일 전용 작업으로 실행하고 앱 여러 개가 동시에 스키마를 수정하지 않게 합니다.
- 컨테이너가 교체되어도 모델·DB·파일·Agent 저널이 남도록 영속 볼륨을 사용합니다.
- 전체 `/data`를 모든 환경에 쓰기 가능으로 마운트하지 않습니다. 환경에는 필요한 프로젝트 파일과 읽기 전용 모델을 연결합니다.
- 실제 로그·workflow·산출물은 저장소 밖의 데이터 볼륨에 두며 백업도 Git에 넣지 않습니다.

## 6. 자체 개발할 API 계약

다음은 서비스 API의 제안 경로입니다. 기존 ComfyUI나 Ollama가 제공하는 API라고 가정하지 않습니다.

| API | 기능 |
| --- | --- |
| `GET /api/me` | 인증 사용자·역할·팀 확인 |
| `GET /api/models` | 분류·설치 상태·호환성 필터 |
| `GET /api/models/{id}/templates` | 선택 가능한 템플릿·환경·의존 모델 |
| `POST /api/models/{id}/install` | 권한 확인 후 다운로드·검증 작업 등록 |
| `GET /api/environments` | 사용 가능한 공용/실험 환경 |
| `POST /api/jobs` | idempotency key와 함께 통합 작업 등록 |
| `GET /api/jobs`, `GET /api/jobs/{id}` | 팀 작업 검색·상세 |
| `POST /api/jobs/{id}/cancel` | 소유자·관리자 정책에 따른 취소 |
| `GET /api/jobs/{id}/events` | 인증된 진행 이벤트와 재연결 커서 |
| `GET /api/assets`, `GET /api/assets/{id}/content` | 공유 파일 검색·인증된 전송 |
| `GET /api/admin/audit` | 관리자 감사 조회 |
| 내부 전용 lease·step·model-event API | Agent·어댑터 인증과 fencing 검증 |

ComfyUI 프런트엔드가 사용하는 원래 경로는 별도 호환 게이트웨이에서 유지합니다. 커스텀 노드의 임의 경로를 공용 API와 섞지 않습니다.

## 7. 단계별 구현과 완료 조건

아래 단계의 실제 서버 통합은 향후 수행할 항목입니다. 현재 완료한 것은 설계 문서와 백엔드에 연결하지 않은 프런트엔드 시안 작성입니다.

| 단계 | 구현 내용 | 완료 조건 |
| --- | --- | --- |
| 0. 호환성 조사 | 호스트·GPU·드라이버 확인, 후보 ComfyUI/PyTorch/CUDA·대표 노드 조합 선정 | 이미지·영상·LLM·임베딩 각 대표 작업 실행 및 peak VRAM 기록 |
| 1. 기반·로그인 | Compose, PostgreSQL 분리 DB, Keycloak, HTTPS, FastAPI BFF | 개인 계정 로그인, 실패·성공·로그아웃·접속 기록, 인증 우회 차단 |
| 2. ComfyUI 연결 | 원래 UI, HTTP/WS 게이트웨이, 업로드·프리뷰·개인 편집 설정 | 두 계정이 편집하고 자신의 세션으로 작업·프리뷰를 연결 |
| 3. 전역 작업 제어 | 작업 원장, outbox, Dispatcher, Celery, Agent, lease·복구 | 여러 사용자의 요청을 공정하게 직렬 실행, 중복 실행 방지와 취소 검증 |
| 4. 모델·감사 | 모델 버전·의존성 DB, runtime 추적, Keycloak 이벤트 수집 | 선언 모델과 실제 사용 모델·캐시·외부 호출을 구분해 검색 |
| 5. 모델 선택 화면 | 카탈로그, 호환성 검사, 예제 workflow 바인딩 | 모델 선택 후 맞는 인코더/VAE/노드 템플릿이 열리고 누락 항목 안내 |
| 6. 공유 저장소 | 산출물 등록·웹 갤러리·다운로드·휴지통 | 팀원이 다른 PC에서 결과·workflow를 다시 열고 파일 접근 기록 확인 |
| 7. LLM·실험 환경 | Ollama 어댑터, 상위 lease 상속, 환경 revision·Manager 제어 | 복합 workflow에서 교착·GPU 중복 점유 없이 실행·모델 기록 |
| 8. 운영 준비 | 장애·백업 복원·다른 호스트 이전·지표 | 지정한 복구 목표와 아래 인수 기준 통과 |

단계 0의 실행 검증은 실제 개발 시작 후 수행할 작업입니다. 이번 문서화 작업 중 GPU 작업이나 서버 설치를 실행하지 않습니다. 의존성 때문에 서로 겹치는 세부 개발은 가능하되 최종 운영에서 인증·GPU 제어·감사를 빠뜨리지 않습니다.

## 8. 인수 검증 시나리오

| 검증 | 기대 결과 |
| --- | --- |
| 사용자 A/B 로그인·실패·로그아웃 | 각 사용자·세션·시각·성공 여부를 구분 |
| 헤더·user ID·client ID 위조 | 실제 로그인 사용자로만 기록, 다른 세션 가로채기 거절 |
| 미로그인 편집기·WS·파일·백엔드 직접 접근 | 거절되거나 로그인 안내; 내부 포트 접근 불가 |
| 기본 UI와 실제 사용 커스텀 노드 | 노드 편집·전용 HTTP/WS·업로드·바이너리 프리뷰·재접속 정상 |
| 모델 선택·템플릿 불러오기 | 로더·VAE·인코더·노드·환경이 맞고 미설치·비호환 조합 설명 |
| 체크포인트+LoRA+VAE+인코더 실행 | 실제 모델 버전·해시·노드·행위자·출력 연결 |
| 캐시·분기·동적 모델·미추적 노드 | 신규 추론·캐시 계보·미실행·unverified를 정확히 구분 |
| 사용자 A 다수 요청 + B 한 개 요청 | 비선점 round-robin 정책대로 B가 배분 기회를 얻음 |
| ComfyUI 여러 환경 + 독립 LLM 동시 요청 | GPU 한 개의 활성 연산 정책 준수 |
| LLM을 포함한 workflow | 동일 상위 lease로 실행하고 모델 교체·메모리 해제·단계 기록 |
| 다른 사람 작업 취소·큐 비우기 | 일반 사용자 거절, 관리자 행위 감사 |
| 브라우저 종료·세션 만료·재로그인 | 승인된 작업 계속, 새 접속에서 결과 확인 |
| 중복 클릭·메시지 중복·제출 응답 유실 | 의도하지 않은 중복 추론 없이 원 시도 조사 |
| 영상 실행 중 worker/Redis/DB 장애 | 기존 연산 상태 확인 전 새 실행 금지, 영속 이력 복구 |
| OOM·취소·모델 해제 실패 | 중단·정리 확인 후 다음 작업, 무한 retry 없음 |
| 노드 설치·환경 업데이트 중 실행 요청 | drain/revision 정책으로 기존 실행 영향 방지 |
| 다른 PC의 공유 파일 재열람·다운로드 | 로그인 필요, 정상 전송·기록, 외부 직접 경로 우회 불가 |
| 다른 Linux GPU 호스트로 이전·복원 | 계정·모델 메타데이터·작업·산출물 연결 유지 |

ComfyUI 및 커스텀 노드의 버전 변경 때 계약 검증을 수행합니다. 모델별 성능을 수치로 보장하기 전에는 대표 설정에서 실제 측정한 값을 사용합니다.

## 9. 운영 전 정할 설정값

동시 사용자와 실제 노드·모델 목록, 사용자별 큐 상한, 작업 종류별 최대 시간, 모델·결과물 예상 용량, 내부 DNS·인증서 배포 방식, 백업 목적지·복구 목표를 확인합니다. 이 값은 설계 진행을 막는 필수 질문으로 두지 않고, 초기 구현에서는 설정 가능하게 만들고 실제 운영 전에 측정·확정합니다.
