# Rough Review Rule

1. `src/main`, `src/test` 외 변경만 있으면 설계 리뷰하지 않고 `리뷰 대상 아님`으로 기록한다.
2. 기존 `review.md`가 있으면 기존 형식·항목·Review History 구조를 그대로 유지한다.
3. 이번 commit의 리뷰 결과만 기존 Review History에 추가하며, 새로운 형식이나 항목을 임의로 만들지 않는다.
4. `PASS/FAIL`은 `rough-architecture.md`의 명백한 위반 여부로만 판단하고, 근거가 없으면 FAIL하지 않는다.
5. 결과는 기존 존재하는 `review.md`의 형식과 Review History 구조를 유지하여 내용을 추가하며, 존재하지 않는다면 새로운 review.md 파일을 본 경로에 생성한다.

Review.md 작성 시 아래 포맷을 반드시 지켜라.

CASE1) 리뷰대상 아닐 경우

```
날짜 : YYYY-MM-DD
diff : 변경전 COMMIT HASH > 변경후 COMMIT HASH
- 결과: 리뷰 대상 아님
- 사유: `src/main`, `src/test` 변경 없음
```

CASE2) 리뷰대상일 경우

```
날짜 : YYYY-MM-DD
diff : 변경전 COMMIT HASH > 변경후 COMMIT HASH
- 결과: PASS / FAIL
- 사유: ...
```