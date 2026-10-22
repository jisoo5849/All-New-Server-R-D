# 사용자·모델·작업 DB와 감사 로그

## 1. 필요한 DB 프로그램

**PostgreSQL 하나를 기본 DB 제품으로 선정**합니다. 계정 인증은 Keycloak, 서비스 데이터 접근은 FastAPI + SQLAlchemy, 스키마 변경은 Alembic으로 구현합니다.

| 저장 영역 | 내용 | 저장 방식 |
| --- | --- | --- |
| PostgreSQL `keycloak` DB | 계정, 비밀번호 해시, 역할, 인증 관련 정보 | Keycloak 전용 DB 사용자만 접근 |
| PostgreSQL `allnew` DB | 사용자 연결, 모델 카탈로그, 작업, 파일 메타데이터, 감사 로그 | 기능별 제한된 DB 사용자 |
| Redis | Celery 메시지, 임시 실시간 알림 | AOF 등 영속화 설정; 업무 원장은 PostgreSQL |
| 파일 볼륨 | 모델 가중치, 이미지·영상·입력 자료, 워크플로우 원본 | DB의 자산 ID와 체크섬으로 연결 |

Keycloak은 PostgreSQL을 지원합니다. 인증 DB와 서비스 DB는 동일 PostgreSQL 인스턴스에 두되 DB와 계정을 분리하고 서비스가 Keycloak 내부 테이블을 직접 수정하지 않습니다. [Keycloak DB 문서](https://www.keycloak.org/server/db)

모델 **목록 관리**에 벡터 DB는 필요하지 않습니다. 향후 텍스트 검색용 벡터를 저장할 실제 RAG 기능이 생기면 pgvector 등의 도입을 별도로 검토합니다. 모델 파일과 임베딩 벡터 데이터, 모델 카탈로그는 서로 다른 데이터입니다.

## 2. 공통 규칙

- 주요 식별자는 UUID를 사용하고 외부 계정은 `(oidc_issuer, oidc_subject)` 복합 unique로 연결합니다.
- 시간은 UTC `timestamptz`로 저장하고 사용자 화면에서 `Asia/Seoul` 등 설정 시간대로 표시합니다.
- 정형 관계는 외래키로, 워크플로우와 실행 옵션은 `jsonb`로 저장합니다. 변경되지 않은 원본 바이트가 필요하면 파일과 별도 SHA-256도 보관합니다.
- 삭제된 사용자·모델·환경도 과거 작업에서 식별할 수 있게 비활성화 또는 tombstone을 유지합니다.
- 행위자와 실행 주체를 구분합니다. 예: 작업자 A가 요청하고 서비스 worker가 실행합니다.
- 모델 버전·실행 환경 revision은 불변이며 파일이 교체되면 새 버전으로 등록합니다.
- 실제 SQL migration과 세부 제약은 구현 단계에 작성합니다. 아래는 논리 스키마입니다.

PostgreSQL `jsonb`는 구조화된 JSON 검색과 인덱싱에 사용할 수 있습니다. 모델 파일 자체를 JSON 또는 대형 BLOB으로 넣지는 않습니다. [PostgreSQL JSON 문서](https://www.postgresql.org/docs/current/datatype-json.html)

## 3. 사용자·접속·감사 테이블

| 테이블 | 주요 컬럼과 제약 |
| --- | --- |
| `users` | `id`, `oidc_issuer`, `oidc_subject`, `display_name`, `status`, `created_at`; issuer/subject unique |
| `teams`, `team_memberships` | 팀·사용자 관계와 member/admin 역할; 초기 팀 하나 |
| `auth_sessions` | 사용자, 서버 세션 ID 해시, 생성·최근 접속·만료·해지 시각; 토큰 원문은 별도 보호 |
| `auth_events` | 원본 이벤트 ID, provider, 로그인 성공/실패/로그아웃, 사용자 nullable, 사유 코드, IP, 시각 |
| `access_events` | 사용자/세션 nullable, request ID, HTTP/WS 종류, 경로 템플릿, 결과 상태, 신뢰된 IP, user agent, 시각 |
| `audit_events` | 행위자 사용자, 실행 서비스, 작업 유형, 대상 유형/ID, job ID, request ID, 결과·사유, 변경 요약, 시각 |

인증 이벤트는 Keycloak의 지원되는 이벤트 조회 API와 영속 이벤트 저장을 기본 수집 경로로 사용합니다. 필요하면 공식 Event Listener SPI 기반 내보내기 어댑터를 추가합니다. 외부 이벤트 ID로 중복 수집을 방지하고 수집 지연과 마지막 커서를 감시합니다.

인증 실패의 입력 사용자명은 인증된 사용자로 취급하지 않습니다. 실제 세션 로그아웃과 창 종료도 구분합니다. 창 종료로 명확한 로그아웃 이벤트가 없으면 `last_seen_at`과 세션 만료를 기록합니다.

## 4. 모델·실행 환경·워크플로우 테이블

| 테이블 | 주요 컬럼과 관계 |
| --- | --- |
| `models` | 논리 모델 ID, 이름, 종류, architecture, 출처·라이선스, 관리 상태 |
| `model_versions` | 모델 ID, 버전, manifest digest, precision/양자화, 실행기 유형, 불변 메타데이터 |
| `model_files` | 모델 버전 ID, 파일 역할, 저장 키, SHA-256, 크기, 검증 상태; 다중 shard 지원 |
| `runtime_model_refs` | 모델 버전과 Ollama manifest digest / 내부 실행기 이름 연결; tag와 digest 구분 |
| `model_dependencies` | 모델 버전 간 인코더·VAE 등 필수/선택 관계와 호환 조건 |
| `environments`, `environment_revisions` | 공용/실험 환경, 이미지 digest, ComfyUI commit, Python·PyTorch·CUDA 버전, 상태 |
| `node_packages`, `environment_nodes` | registry ID 또는 저장소, 버전/commit, 설치 출처와 환경 revision 연결 |
| `workflow_templates`, `workflow_template_versions` | 템플릿 이름, UI workflow와 실행 graph, revision, 검증 상태 |
| `template_model_bindings` | 템플릿 버전, 모델 역할, 배치할 node/input, 허용 모델 버전 조건 |
| `compatibility_checks` | 템플릿·모델 조합·환경 revision, 실제 검증 결과, 기준 설정, 실행 시각 |

같은 파일명이더라도 SHA-256 또는 manifest digest가 다르면 다른 모델 버전입니다. Ollama tag가 새 digest를 가리키면 기존 실행 기록을 덮어쓰지 않고 새 버전을 연결합니다. 다중 파일 모델은 개별 파일 해시와 전체 manifest를 함께 보관합니다.

## 5. 작업·실행·자원·파일 테이블

| 테이블 | 주요 컬럼과 관계 |
| --- | --- |
| `projects`, `workflows` | 팀 공유 프로젝트와 편집용 workflow revision |
| `jobs` | 팀, 제출자, 종류, 상태, 프로젝트, 환경 revision, 그래프 스냅샷, 설정, 대기·시작·종료 시각, idempotency key |
| `job_attempts` | 작업 ID, 시도 번호, backend prompt/request ID, 실행기 ID, 상태, 오류, 종료 사유; job/attempt unique |
| `job_steps` | 시도 ID, 노드/단계 ID, 종류, 상위 단계, 시작·종료, 외부 호출 여부 |
| `job_models` | 작업·시도·단계·노드, 모델 버전, 선언/실제/캐시 구분, 로딩·사용 이벤트, 추적 어댑터와 신뢰 수준 |
| `job_events` | 작업·시도 ID, 순번, 상태/진행 이벤트, 시각; 재접속용 영속 이벤트 |
| `job_usage_samples` | 시도, GPU UUID, VRAM·사용률, 시각; 보존 기간을 정한 집계용 표본 |
| `gpu_resources` | GPU UUID, 호스트, 상태, 세대 번호, 기준 점유량·정책 |
| `gpu_leases` | GPU, 시도, fencing token, 상태, 발급·heartbeat·만료 시각; GPU별 활성 lease unique |
| `scheduler_user_state` | 사용자별 마지막 배분 순번·대기 상태; round-robin 트랜잭션에 사용 |
| `assets`, `job_assets` | 파일 저장 키, checksum, MIME, 크기, 작성자, 입출력 역할, 생성 중/게시/휴지통 상태 |
| `asset_events` | 사용자·파일·열람/다운로드/수정/삭제/복구 유형·시각; 전송 시작/완료/중단 구분 |
| `outbox_events` | 이벤트 ID, 종류, payload, 발행·확인 시각, 재시도 횟수 |

실행 시간이 곧 순수 GPU 사용 시간인 것은 아닙니다. 대기시간, 전체 실행시간, GPU 측정값을 구분하고 작업 점유 시간을 요금이나 정밀 GPU 연산량처럼 표시하지 않습니다.

## 6. ‘어떤 모델을 사용했는가’ 기록 방법

### 제출 시 선언 기록

워크플로우를 분석해 체크포인트, diffusion model, LoRA, VAE, 텍스트 인코더, ControlNet, 업스케일러 등 로더에 지정된 모델을 추출합니다. 로더 클래스와 입력 필드는 어댑터 registry로 관리합니다. LLM 요청은 실행기, 모델 식별자와 digest를 기록합니다.

### 실행 시 관측 기록

백엔드 instrumentation과 모델 로딩/추론 어댑터에서 실제로 사용한 모델 버전, 노드, 단계, 시각을 수집합니다. 연결되지 않은 노드, 분기에서 실행되지 않은 모델, 캐시 재사용, 실제 로딩/추론을 구분합니다. 클라이언트가 모델명을 보고하는 것만으로 사용 이력을 확정하지 않습니다.

### 캐시·동적 모델·미등록 노드

- 캐시 출력은 원래 생성 작업·모델 계보를 연결하고 현재 작업의 신규 추론으로 집계하지 않습니다.
- 런타임에 모델이 바뀌면 각 단계의 실제 모델 이벤트를 별도로 기록합니다.
- 외부 API 모델은 provider·모델·호출 ID와 외부 실행 여부를 기록합니다. 메인 GPU 사용으로 표시하지 않습니다.
- 추적할 수 없는 노드·동적 로딩은 `unverified`와 원인을 표시합니다. 모르는 모델을 추정해 확정 기록하지 않습니다.
- 정식 운영에서 ‘완전 추적’으로 표시할 환경은 설치된 모든 모델 실행 경로의 어댑터와 검증 기준을 충족해야 합니다.

임의 Python 노드의 내부 동작을 일반 프록시만으로 완전히 관찰할 수는 없습니다. 자유로운 실험 실행은 가능하게 하되, 기록 완전성은 `declared_only`, `runtime_verified`, `unverified`로 구분합니다. 전 모델 사용 기록 요건의 완료 기준은 등록된 실제 운영 노드에서 누락 없이 검증된 상태입니다.

## 7. 남길 작업 내용과 이력 화면

작업별로 제출자, 접속 세션, 시각, 프로젝트, 워크플로우 스냅샷, 모델 목록, 노드·패키지 버전, 프롬프트·seed·생성 옵션, 입력 자산, 상태·오류·취소자, 결과 자산을 연결합니다. 재현용 원본은 접근 통제된 저장소에 보관하고 비밀번호·API 키·세션 토큰은 스냅샷에서도 제거하여 비밀 참조 ID로 대체합니다.

팀 화면은 작업자·기간·모델·작업 종류·성공 여부로 검색하고 결과와 워크플로우를 함께 엽니다. 관리자 감사 화면은 접속·설치·환경 변경·파일 삭제·역할 변경까지 조회하고 CSV 내보내기를 제공합니다. 내보내기 자체도 감사 이벤트를 남깁니다.

## 8. 무결성·보존·백업

- 서비스 DB 역할을 분리하여 일반 애플리케이션의 감사 테이블 UPDATE/DELETE 권한을 제거합니다.
- 감사 기록은 append-only로 다루고 보존 정책에 따른 삭제는 전용 운영 역할로 수행합니다. DB 최고 관리자까지 변경 불가능하다고 보장하지 않습니다.
- 로그인·작업 제출·취소·모델 변경·파일 변경은 감사 이벤트가 영속화되어야 성공 응답합니다. DB 장애 중에는 변경을 허용하지 않습니다.
- 대용량 접근 로그는 Caddy의 로컬 영속 스풀 후 수집할 수 있게 하고 누락·디스크 부족 경보를 둡니다. 자산 전송은 요청/전송 상태를 기록하며 사용자가 실제 내용을 읽었는지까지 주장하지 않습니다.
- UTC 시각, request/job ID를 공통 키로 사용하고 호스트 시계를 동기화합니다.
- 초기 제안 보존값: 접근 로그 90일, 인증·중요 감사·작업 기록 1년. 실제 운영 전 저장량과 팀 정책에 맞춰 설정합니다.
- 사용자·시각, job·event 순번, 모델 버전, 상태·대기 순번, 미발행 outbox에 인덱스를 둡니다. 증가량에 따라 월별 파티션을 검토합니다.
- PostgreSQL 백업과 파일 manifest를 일관된 복구 시점으로 연결하고 별도 장치에도 복사합니다. 로그·프롬프트·백업을 공개 Git 저장소에 저장하지 않습니다.
