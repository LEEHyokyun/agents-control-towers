## Codex Agent Review Control Tower

> WAY1
> - Pre-commit 시점에 새로운 agent를 실행하고 설계 사상을 새롭게 주입한다.

![agents_review_archi.png](agents_review_archi.png)

> WAY2
> - 로컬 agent에게 설계 사상을 최초 주입한 후 이를 기억하게 하며, 로컬 프로젝트는 Pre-commit 시점에 변경 내역만 전달한다.

![codex-agent-review-flow.drawio.png](codex-agent-review-flow.drawio.png)