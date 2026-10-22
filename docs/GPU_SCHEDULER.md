# GPU 스케줄러 상세 설계

> 선정: **Celery + Redis 작업 실행 기반과 PostgreSQL 기반 전역 GPU Dispatcher / Execution Agent를 조합**합니다. 직접 개발할 계층을 포함한 설계이며 설치만으로 완성되는 제품 구성이 아닙니다.

## 1. 구성별 책임

| 구성 | 책임 | 맡기지 않는 책임 |
| --- | --- | --- |
| PostgreSQL | 작업·시도·GPU lease·감사 기록의 영속 원장 | 대형 결과 파일 저장 |
| Dispatcher | 사용자별 공정 선택, GPU 예약, 복구, 실행 메시지 발행 | 모델 추론 |
| Redis | Celery 브로커, 실시간 상태 알림 | 작업·감사 기록의 유일한 저장소 |
| Celery GPU Worker | 선택된 작업을 Execution Agent로 실행 요청하고 완료까지 추적 | 자체 판단으로 무제한 GPU 작업 시작 |
| Execution Agent | lease 검증, 런타임 제어, 실행·중단·정리 확인 | 사용자 로그인 처리 |
| ComfyUI / Ollama | 허용된 작업의 모델 연산 | 다른 서비스와의 공정 배분 |

Celery의 `concurrency=1`은 해당 worker의 동시성만 제한합니다. 별도의 worker, 직접 제출된 ComfyUI 작업, Ollama 요청까지 자동으로 제어하지 않으므로 전역 lease와 단일 실행 권한 경로가 필요합니다.

작업 대기열은 PostgreSQL에서 관리합니다. Dispatcher가 실행할 작업을 고른 뒤에만 Celery에 전달하므로 Redis에 사용자의 모든 작업을 먼저 쌓아 공정성을 잃는 구성을 피합니다.

## 2. 초기 정책

- 메인 GPU 한 개에 GPU lease 한 개를 발급합니다.
- 이미지·영상·LLM·임베딩의 무거운 연산은 모두 같은 자원 풀을 사용합니다.
- 사용자별 FIFO 대기열을 두고 사용자 사이에는 round-robin으로 배분합니다.
- 실행 중인 생성 작업을 다른 사용자 작업 때문에 강제 선점하지 않습니다.
- 초기 사용자별 대기 작업 상한은 설정값으로 제공하고 관리자 화면에서 조정합니다.
- 관리자 우선순위 변경과 다른 사람 작업 취소는 이유와 행위자를 기록합니다.
- 실행 시간 제한은 작업 종류·설정별로 정하고 제출 시 표시합니다. 무제한 실행을 기본으로 두지 않습니다.
- CPU 썸네일·체크섬·모델 다운로드는 별도 worker에서 실행합니다. GPU를 쓰는 전처리·업스케일러는 GPU 작업으로 분류합니다.

동시 실행 확대는 실제 모델·해상도·영상 길이·LLM 컨텍스트별 peak VRAM과 처리 시간 측정 후 검토합니다. 단순한 남은 VRAM 값만으로 미검증 커스텀 노드 작업을 병렬 배치하지 않습니다.

## 3. 작업 상태와 제출

```text
submitted -> validating -> queued -> dispatching -> running -> finalizing -> succeeded
                 |                       |            |           |
               rejected                  +----------> failed <----+
queued -> cancelled
dispatching / running -> cancel_requested -> cancelling -> cancelled
dispatching / running / cancelling -> recovering -> 원 실행 확인 또는 failed / cancelled
```

`recovering`은 실행 여부가 불명확한 상태입니다. 곧바로 `queued`로 돌려 중복 생성하지 않습니다. 작업 자체와 각 실행 시도(`job_attempts`)의 상태를 분리합니다.

제출 트랜잭션은 사용자·워크플로우 스냅샷·선언 모델·`jobs`·`outbox`를 함께 저장합니다. 커밋 후 outbox relay가 브로커 메시지를 발행합니다. 브로커 장애 시 DB에 남은 메시지를 재발행하고, 중복 발행은 작업/시도 ID와 조건부 상태 변경으로 흡수합니다.

## 4. GPU lease와 실행 절차

1. Dispatcher가 짧은 DB 트랜잭션에서 GPU 행과 사용자별 배분 상태를 잠급니다.
2. GPU가 `idle`이고 복구 대기 중이 아니면 다음 사용자의 준비된 작업을 고릅니다.
3. 작업을 `dispatching`으로 바꾸고 시도 ID, 만료 시각, 증가하는 fencing token을 가진 lease와 outbox 이벤트를 생성합니다.
4. Celery Worker가 메시지를 수신하고 동일한 시도가 이미 실행·완료되었는지 확인합니다.
5. Execution Agent가 GPU·시도 ID·fencing token을 다시 검증합니다. 만료되거나 이전 세대인 요청을 거절합니다.
6. 직전 실행기의 정리 상태를 확인하고 선택한 환경에만 새 연산을 허용합니다.
7. 백엔드에 제출하고 backend prompt ID / request ID를 DB에 연결합니다. 제출 의도는 요청 전에 저장합니다.
8. 작업이 살아 있는 동안 Agent가 heartbeat와 진행 상태를 기록합니다. Celery 메시지 수신 자체를 heartbeat로 취급하지 않습니다.
9. 완료 이벤트와 백엔드 이력, 결과 파일을 대조해 산출물을 등록합니다.
10. 다른 실행기로 넘어갈 경우 모델 메모리를 해제하고 종료·정리 상태를 확인한 뒤 GPU를 `idle`로 바꿉니다.

DB 잠금은 예약·상태 전이 같은 짧은 트랜잭션에만 사용합니다. 생성 작업 전체 시간 동안 트랜잭션을 열어 두지 않습니다. `(gpu_id)`별 활성 lease 하나, `(job_id, attempt_no)` 유일성을 DB 제약과 조건부 갱신으로 보장합니다.

lease TTL 만료는 **새 실행 허가 조건이 아니라 복구 신호**입니다. DB 연결이 끊겨 잠금이 풀려도 기존 GPU 연산은 계속될 수 있습니다. Agent가 기존 백엔드의 작업·프로세스 상태를 확인하고 필요하면 중단·재시작한 뒤에만 다음 lease를 실행합니다. fencing token은 협력하는 Agent의 요청을 차단할 뿐 이미 실행 중인 GPU 커널을 종료시키지 못합니다.

## 5. Celery 기본 구성과 긴 영상 작업

GPU 전용 worker는 초기 하나로 두고 다음 값을 명시적으로 설정합니다.

```python
# 향후 구현할 설정의 예시입니다. 이 저장소에 실행 애플리케이션은 없습니다.
worker_concurrency = 1
worker_prefetch_multiplier = 1
task_acks_late = True
```

CPU worker는 별도 큐와 프로세스로 운영합니다. 위 설정은 작업 멱등성을 전제로 합니다. 강제 종료 시 재전달 여부와 자동 retry 정책은 별도로 명시하고, 전달된 메시지가 기존 실행을 무조건 새로 시작하게 하지 않습니다. [Celery prefetch·late acknowledgment](https://docs.celeryq.dev/en/stable/userguide/optimizing.html)

Redis 브로커의 visibility timeout보다 작업 실행이 길어지면 메시지가 재전달될 수 있습니다. 종류별 최대 실행 시간과 정리 시간을 먼저 정하고, Celery의 `broker_transport_options`, `result_backend_transport_options`, 전역 `visibility_timeout`을 해당 상한보다 여유 있게 일치시킵니다. 같은 Redis를 공유하는 다른 Celery 앱의 설정도 조사합니다. 긴 timeout은 장애 후 재전달도 늦추므로 DB 원장과 복구 감시를 함께 사용합니다. [Celery Redis caveats](https://docs.celeryq.dev/en/stable/getting-started/backends-and-brokers/redis.html)

Celery의 `revoke`나 worker 종료만으로 이미 원격 ComfyUI에 제출한 연산이 중단되지는 않습니다. 실제 백엔드 중단 요청과 종료 확인을 Execution Agent에서 수행합니다. 브로커 연결이 끊기더라도 기존 lease가 해결될 때까지 다른 연산을 시작하지 않습니다.

GPU 작업에는 검증된 외부 중단 절차 없이 Celery hard time limit만 적용하지 않습니다. 원격 실행 상태가 남을 수 있기 때문입니다. Agent의 작업 deadline, 정상 취소, 강제 정리, 재기동 확인 순서로 처리합니다.

## 6. ComfyUI의 원래 실행 버튼과 연결

게이트웨이가 `/prompt`를 가로채 전역 작업을 만들고 ComfyUI 호환 응답을 반환합니다. 외부 `prompt_id`는 서비스 작업 UUID로 고정하고 내부 backend prompt ID는 시도별로 관리합니다. 게이트웨이가 HTTP 응답·WebSocket·이력·취소에서 두 ID를 매핑합니다.

고정할 ComfyUI 버전이 제출 시 UUID 지정 기능을 지원하면 내부 시도 UUID를 전달합니다. 응답 유실 시 해당 ID의 큐·이력을 조회한 뒤 재시도 여부를 결정합니다. UUID를 보낸다는 사실만으로 백엔드가 중복 제출을 방지한다고 가정하지 않습니다. 조사 시점 소스에는 지정 UUID 처리 경로가 있지만 실제 채택 commit에서 계약 검증해야 합니다. [ComfyUI server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)

검증과 큐 등록을 분리하는 내부 validation 어댑터를 구현하여 노드 오류를 실행 전에 반환합니다. 검증 단계에서 GPU를 사용하는 노드는 해당 단계도 자원 배분 대상입니다. 백엔드의 실제 큐에 미리 등록해 놓고 나중에 lease를 부여하는 방식은 사용하지 않습니다.

`/queue`, `/history`, `/ws`와 버전별 작업 API는 전역 DB를 기준으로 합성·변환합니다. 화면의 큐 번호는 현재 배분 상태의 스냅샷이며 사용자별 공정 배분 때문에 고정 실행 순서를 약속하지 않습니다. 브라우저가 연결을 끊어도 실행기는 서버에서 계속 추적합니다.

## 7. LLM을 호출하는 복합 워크플로우

예: `LLM 프롬프트 작성 -> 이미지 생성 -> 영상 생성`.

- 하나의 상위 작업과 GPU lease를 사용하고 각 호출을 `job_steps`로 기록합니다.
- 내부 LLM 호출은 상위 lease를 상속합니다. 별도 최상위 작업을 만들고 같은 GPU lease를 다시 기다리지 않습니다.
- 호출 어댑터가 시도·단계·만료 범위로 제한된 내부 capability를 검증합니다. 브라우저가 보낸 parent ID만으로 상속을 허용하지 않습니다.
- LLM 호출 후 필요하면 모델을 해제하고 이미지/영상 모델을 로드합니다.
- 동시에 상주해야 하는 모델 조합은 메모리 프로파일을 검증합니다. 단순히 전체 워크플로우를 직렬화하는 것으로 내부 OOM까지 해결되지 않습니다.

ComfyUI가 raw Ollama 포트에 직접 접근하는 대신 내부 추론 어댑터를 사용하도록 노드의 API base URL을 설정합니다. 별도로 제출된 LLM 요청은 새 작업으로 전역 큐에 들어갑니다. Ollama의 메모리 유지·해제 정책도 명시합니다. [Ollama keep_alive](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately)

## 8. 취소·재시도·장애 복구

| 상황 | 처리 |
| --- | --- |
| 대기 작업 취소 | DB에서 조건부 상태 전이; 늦게 온 메시지는 실행하지 않음 |
| 실행 작업 취소 | 소유자/관리자 확인, 해당 backend 작업만 중단, 정리 확인 후 lease 반환 |
| Worker 종료 | `recovering`; 백엔드 큐·이력·Agent 프로세스를 대조 |
| 제출 응답 유실 | 제출 의도와 backend ID로 실행 여부 조사; 불명확하면 자동 재제출 금지 |
| Redis 재시작·메시지 유실 | PostgreSQL의 미전달 outbox와 미해결 작업을 재조정 |
| PostgreSQL 불가 | 새 실행과 인증된 변경 요청을 중단; 기존 작업을 Agent의 영속 저널로 추적 후 복구 |
| OOM | 원인·프로파일 기록, 모델 정리 확인; 동일 설정 무한 재시도 금지 |
| 모델 해제 실패 | 해당 실행기 drain/재시작; GPU 상태 확인 전 다음 작업 차단 |
| 서버 재부팅 | DB·Agent 저널·파일·백엔드 상태를 대조하고 미완료 시도 정리 |

작업 결과는 `<job-id>/<attempt-id>`별로 저장하여 재시도 결과가 기존 파일을 덮어쓰지 않게 합니다. 사용자의 중복 클릭에는 idempotency key를 적용합니다. 명시적인 ‘다시 생성’은 새 키를 사용하므로 같은 프롬프트의 의도적인 반복 실행은 허용됩니다.

## 9. 자원 우회와 관측

ComfyUI·Ollama 포트는 외부에 노출하지 않고 GPU 실행 경로를 어댑터로 제한합니다. 노드의 별도 HTTP 경로·백그라운드 실행·외부 API 호출도 조사합니다. 미검증 실험 환경은 다른 환경과 함께 GPU 연산하지 않도록 배타 실행하고 전환 시 프로세스와 메모리를 확인합니다.

NVML 기반 GPU 메모리·사용률·프로세스 지표를 수집하되 드라이버 등의 기준 점유량과 구분합니다. ‘요청을 보냈다’ 또는 ‘사용률이 0이다’만으로 종료 판정하지 않습니다. 커스텀 코드의 GPU 접근에 대한 하드웨어 수준 격리를 Docker나 소프트웨어 lease가 보장한다고 표현하지 않습니다.

필수 지표는 사용자별 대기시간, 종류별 실행시간, 최대 VRAM, 모델 전환 시간, OOM, 취소 지연, lease heartbeat 지연, 중복 메시지 수, 복구 작업 수입니다. GPU 한 장을 사용하는 현재 범위에서는 Slurm이나 Kubernetes를 추가하지 않고 다중 서버 운영이 필요해질 때 재검토합니다.
