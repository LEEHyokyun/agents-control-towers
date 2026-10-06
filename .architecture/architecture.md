# Architecture Principles

## 1. Architecture의 목적

Architecture는 특정 디렉터리 구조를 지키는 것이 아니다.

Architecture의 핵심은

> 변경 가능성이 높은 구체적인 구현이
> 핵심 정책과 불필요하게 결합되지 않도록 관계를 구성하는 것

이다.

따라서 다음 구조를 무조건 강제하지 않는다.

```text
Controller
Service
Repository
Domain
Infrastructure
```

중요한 것은 이름이 아니라
각 구성요소의 책임과 의존성 방향이다.

---

# 2. Dependency Direction

의존성 방향을 검토할 때 다음을 확인한다.

```text
누가 누구를 알아야 하는가?
```

특히 핵심 비즈니스 정책이

- Database
- Framework
- HTTP
- 외부 API
- 메시지 브로커
- 캐시
- 특정 구현체

등의 구체적인 기술에 불필요하게 종속되는지 확인한다.

---

# 3. Layer 분리

계층은 서로 다른 책임을 분리하기 위해 존재한다.

계층을 늘리는 것 자체를 목표로 하지 않는다.

예:

```text
Controller
→ Application Service
→ Domain
→ Repository
```

가 필요할 수 있지만,

단순 CRUD 하나를 위해

```text
Controller
→ Facade
→ Coordinator
→ Manager
→ Service
→ Handler
→ Repository
```

처럼 의미 없는 계층을 추가하는 것은 경계한다.

각 계층의 존재 이유를 설명할 수 있어야 한다.

---

# 4. Controller

Controller는 HTTP 또는 외부 요청의 경계를 담당한다.

다음 책임이 과도하게 들어가는지 확인한다.

- 복잡한 비즈니스 정책
- DB 조작
- 트랜잭션 정책
- 외부 시스템의 세부 구현
- 복잡한 데이터 처리

---

# 5. Application Service

Application Service는 여러 객체의 협력이나
하나의 유스케이스 실행 흐름을 조정할 수 있다.

그러나 Domain 객체가 수행해야 할 책임까지
무조건 Service에 몰아넣지 않는다.

---

# 6. Domain

Domain 객체는 실제 비즈니스 규칙과 불변조건을 표현할 필요가 있을 때 사용한다.

모든 데이터를 Domain 객체로 만드는 것을 강제하지 않는다.

CRUD 중심의 단순한 영역과
복잡한 비즈니스 규칙이 존재하는 영역을 동일하게 취급하지 않는다.

---

# 7. Repository

Repository의 책임은 Domain 또는 Application에서
데이터 저장소의 구체적인 접근 방법을 분리하는 것이다.

Repository가 다음 책임까지 과도하게 가지는지 확인한다.

- 복잡한 비즈니스 정책
- 외부 시스템 orchestration
- HTTP 요청
- 메시지 처리 정책

---

# 8. Infrastructure

Infrastructure는 구체적인 기술 구현을 담당한다.

예:

- DB
- Redis
- Kafka
- RabbitMQ
- HTTP Client
- 파일 시스템
- 외부 API
- Framework Adapter

핵심 정책이 특정 인프라의 세부 구현에
불필요하게 결합되지 않도록 한다.

---

# 9. DDD

DDD의 개념을 사용해야 한다는 이유만으로
모든 코드에 DDD 전술 패턴을 적용하지 않는다.

다음과 같은 도메인 복잡성이 존재하는지 먼저 확인한다.

- 복잡한 비즈니스 규칙
- 도메인 상태 변화
- 도메인 불변조건
- 여러 객체 간 도메인 관계
- 비즈니스 용어와 코드 모델의 불일치

단순 CRUD 영역에서는 더 단순한 구조가 적절할 수 있다.

---

# 10. Transaction

트랜잭션 경계는 데이터 정합성과 유스케이스의 원자성을 기준으로 판단한다.

단순히 Service 메서드마다
`@Transactional`을 붙이는 것을 목표로 하지 않는다.

확인할 사항:

- 어떤 작업이 하나의 원자적 단위인가?
- 어떤 데이터가 함께 변경되어야 하는가?
- 외부 시스템 호출이 포함되는가?
- 실패 시 어떤 상태가 남는가?
- 재시도 시 중복 처리가 발생하는가?

---

# 11. Concurrency

동시성 문제는 단순히 Lock을 추가하는 것으로 해결하지 않는다.

먼저 확인한다.

```text
공유 상태
↓
경쟁 조건
↓
불변조건
↓
허용 가능한 동시성
↓
필요한 제어 방법
```

가능한 수단은 문제에 따라 달라진다.

- synchronized
- Lock
- Semaphore
- Queue
- DB Lock
- Optimistic Lock
- Pessimistic Lock
- 분산 제어
- 메시지 기반 처리

특정 기술을 기본 정답으로 취급하지 않는다.

---

# 12. Cache

캐시는 성능을 위해 사용하는 기술이지만
캐시 도입 자체가 목적이 아니다.

검토할 사항:

- 무엇이 병목인가?
- 읽기/쓰기 비율은 어떤가?
- 데이터 변경 빈도는 어떤가?
- 허용 가능한 stale 데이터 범위는?
- 캐시 불일치가 발생하면 어떻게 되는가?
- 원본 데이터와 캐시의 관계는?
- 캐시 장애 시 시스템은 어떻게 동작하는가?

---

# 13. Message Queue

Kafka/RabbitMQ 등의 메시징 시스템을 사용한다면
단순 비동기화를 넘어 다음을 확인한다.

- 메시지 전달 보장
- 중복 처리
- 순서
- 재처리
- 실패 메시지
- Idempotency
- 데이터 정합성
- 소비자 장애

기술 도입만으로 해당 문제가 해결되었다고 판단하지 않는다.

---

# 14. Architecture Review

Architecture 변경 시 반드시 다음 질문을 수행한다.

```text
무엇이 문제인가?
↓
현재 구조에서 왜 문제가 발생하는가?
↓
어떤 경계를 새롭게 만들어야 하는가?
↓
새로운 경계가 어떤 책임을 분리하는가?
↓
의존성 방향이 어떻게 변경되는가?
↓
복잡성이 얼마나 증가하는가?
↓
그 복잡성이 정당한가?
```