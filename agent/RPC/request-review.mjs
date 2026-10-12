
import { execFileSync } from "node:child_process";
import path from "node:path";

function git(args) {
    return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
    }).trimEnd();
}

async function main() {
    const projectDir = git(["rev-parse", "--show-toplevel"]);
    const projectName = path.basename(projectDir);
    const commitHash = git(["rev-parse", "HEAD"]);

    let parentHash = "";

    try {
        parentHash = git(["rev-parse", "HEAD^"]);
    } catch {
        // 최초 커밋
    }

    const diff = parentHash
        ? git([
            "diff",
            "--no-ext-diff",
            parentHash,
            commitHash,
            "--",
        ])
        : git([
            "show",
            "--format=",
            "--no-ext-diff",
            "--root",
            commitHash,
        ]);

    if (!diff.trim()) {
        console.log("[INFO] 검토할 변경 사항이 없습니다.");
        return;
    }

    const changedFiles = parentHash
        ? git([
            "diff",
            "--name-only",
            parentHash,
            commitHash,
            "--",
        ])
        : git([
            "show",
            "--format=",
            "--no-ext-diff",
            "--root",
            "--name-only",
            commitHash,
        ]);

    let response;

    try {
        response = await fetch("http://127.0.0.1:47831/review", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                projectName,
                commitHash,
                parentHash,
                changedFiles: changedFiles
                    ? changedFiles.split("\n").filter(Boolean)
                    : [],
                diff,
            }),
            signal: AbortSignal.timeout(10 * 60 * 1000),
        });
    } catch (error) {
        console.error(
            "[ERROR] 중앙 에이전트에 연결할 수 없습니다:",
            error.message,
        );
        process.exitCode = 1;
        return;
    }

    let result;

    try {
        result = await response.json();
    } catch {
        console.error(
            `[ERROR] 서버 응답이 올바른 JSON이 아닙니다. HTTP ${response.status}`,
        );
        process.exitCode = 1;
        return;
    }

    if (!response.ok || !result.success) {
        console.error(
            "[ERROR] 설계 사상 검증 실패:",
            result.error ?? `HTTP ${response.status}`,
        );
        process.exitCode = 1;
        return;
    }

    console.log("[INFO] 설계 사상 검증 및 리뷰 기록 완료");
    console.log(result.reviewPath);
}

main().catch((error) => {
    console.error("[ERROR] 검토 요청 처리 실패:", error.message);
    process.exitCode = 1;
});