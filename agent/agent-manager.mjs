
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import {
    mkdir,
    readFile,
    writeFile,
    rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// agent-manager.mjs가 있는 agent 폴더의 상위 폴더
const CONTROL_TOWER = path.resolve(__dirname, "..");

const STATE_DIR = path.join(CONTROL_TOWER, "agent-status");
const STATE_FILE = path.join(STATE_DIR, "agent-status.json");

const REVIEW_DIR = path.join(CONTROL_TOWER, "review");

/*
* 코덱스 에이전트 HTTP 서버 생성
* */
const HOST = "127.0.0.1";
const PORT = 47831;

const CLIENT_INFO = {
    name: "agent_manager",
    title: "Architecture Review Agent Manager",
    version: "1.0.0",
};

const REFERENCES = [
    {
        name: "rough-rule.md",
        path: path.join(
            CONTROL_TOWER,
            "rough-rule",
            "rough-rule.md",
        ),
    },
    {
        name: "rough-architecture.md",
        path: path.join(
            CONTROL_TOWER,
            ".rough-architecture",
            "rough-architecture.md",
        ),
    },
];

let server;
let shuttingDown = false;

// 동일한 스레드에 검토 요청을 동시에 보내지 않도록 직렬화합니다.
let reviewQueue = Promise.resolve();

function log(level, message) {
    console.log(`[${level}] ${message}`);
}

function sha256(value) {
    return createHash("sha256")
        .update(value, "utf8")
        .digest("hex");
}

async function ensureDirectory(directory) {
    await mkdir(directory, { recursive: true });
}

async function loadState() {
    await ensureDirectory(STATE_DIR);

    try {
        return JSON.parse(await readFile(STATE_FILE, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }

        return {
            agent: {
                initialized: false,
                threadId: null,
                lastStartedAt: null,
            },
            references: {},
        };
    }
}

async function saveState(state) {
    await ensureDirectory(STATE_DIR);

    const temporaryFile = `${STATE_FILE}.tmp`;

    await writeFile(
        temporaryFile,
        JSON.stringify(state, null, 2),
        "utf8",
    );

    await rename(temporaryFile, STATE_FILE);
}

async function loadReferences() {
    const references = [];

    for (const reference of REFERENCES) {
        const content = await readFile(reference.path, "utf8");

        references.push({
            name: reference.name,
            path: reference.path,
            content,
            hash: sha256(content),
        });
    }

    return references;
}

class CodexAppServer {
    constructor() {
        this.process = null;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.turnWaiters = new Map();
        this.initialized = false;
    }

    async start() {
        if (this.process) {
            throw new Error("Codex App Server가 이미 실행 중입니다.");
        }

        log("INFO", "Codex App Server를 시작합니다.");

        this.process = spawn(
            "codex",
            ["app-server", "--listen", "stdio://"],
            {
                cwd: CONTROL_TOWER,
                stdio: ["pipe", "pipe", "inherit"],
                windowsHide: true,
                shell: process.platform === "win32",
            },
        );

        this.process.on("error", (error) => {
            log("ERROR", `App Server 프로세스 오류: ${error.message}`);

            for (const [id, pending] of this.pending) {
                pending.reject(error);
                this.pending.delete(id);
            }

            for (const [threadId, waiter] of this.turnWaiters) {
                waiter.reject(error);
                this.turnWaiters.delete(threadId);
            }
        });

        this.process.on("exit", (code, signal) => {
            this.process = null;
            this.initialized = false;

            const error = new Error(
                `Codex App Server 종료: code=${code}, signal=${signal}`,
            );

            for (const [id, pending] of this.pending) {
                pending.reject(error);
                this.pending.delete(id);
            }

            for (const [threadId, waiter] of this.turnWaiters) {
                waiter.reject(error);
                this.turnWaiters.delete(threadId);
            }

            log("ERROR", error.message);
        });

        const lines = createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
        });

        lines.on("line", (line) => {
            this.handleMessage(line);
        });

        await this.request("initialize", {
            clientInfo: CLIENT_INFO,
        });

        this.notify("initialized", {});
        this.initialized = true;

        log("INFO", "Codex App Server 초기화 완료");
    }

    handleMessage(line) {
        let message;

        try {
            message = JSON.parse(line);
        } catch {
            log("WARN", `JSON-RPC 응답 파싱 실패: ${line}`);
            return;
        }

        // JSON-RPC 응답
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);

            if (!pending) {
                return;
            }

            this.pending.delete(message.id);

            if (message.error) {
                pending.reject(
                    new Error(
                        message.error.message ??
                        JSON.stringify(message.error),
                    ),
                );
            } else {
                pending.resolve(message.result);
            }

            return;
        }

        // JSON-RPC 알림
        const method = message.method;
        const params = message.params ?? {};

        if (method === "item/agentMessage/delta") {
            const waiter = this.turnWaiters.get(params.threadId);

            if (waiter) {
                if (
                    !waiter.turnId ||
                    waiter.turnId === params.turnId
                ) {
                    waiter.chunks.push(params.delta ?? "");
                }
            }

            return;
        }

        if (method === "turn/completed") {
            const waiter = this.turnWaiters.get(params.threadId);

            if (!waiter) {
                return;
            }

            if (
                waiter.turnId &&
                params.turn?.id &&
                waiter.turnId !== params.turn.id
            ) {
                return;
            }

            waiter.resolve(params.turn ?? {});
            this.turnWaiters.delete(params.threadId);
        }
    }

    request(method, params = {}) {
        if (!this.process || !this.initialized && method !== "initialize") {
            // initialize 요청은 초기화 플래그 설정 전에 허용합니다.
            if (method !== "initialize") {
                return Promise.reject(
                    new Error("Codex App Server가 초기화되지 않았습니다."),
                );
            }
        }

        const id = this.nextRequestId++;

        const payload = {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            this.process.stdin.write(
                `${JSON.stringify(payload)}\n`,
                (error) => {
                    if (error) {
                        this.pending.delete(id);
                        reject(error);
                    }
                },
            );
        });
    }

    notify(method, params = {}) {
        if (!this.process) {
            throw new Error("Codex App Server가 실행 중이지 않습니다.");
        }

        this.process.stdin.write(
            `${JSON.stringify({
                jsonrpc: "2.0",
                method,
                params,
            })}\n`,
        );
    }

    async openThread(previousThreadId) {
        if (previousThreadId) {
            try {
                const result = await this.request("thread/resume", {
                    threadId: previousThreadId,
                    cwd: CONTROL_TOWER,
                });

                log("INFO", "기존 Codex 스레드를 재개했습니다.");

                return result.thread.id;
            } catch (error) {
                log(
                    "WARN",
                    `기존 스레드 재개 실패. 새 스레드를 생성합니다: ${error.message}`,
                );
            }
        }

        const result = await this.request("thread/start", {
            cwd: CONTROL_TOWER,
        });

        log("INFO", "새 Codex 스레드를 생성했습니다.");

        return result.thread.id;
    }

    async sendTurn(threadId, prompt) {
        if (!threadId) {
            throw new Error("검토에 사용할 threadId가 없습니다.");
        }

        if (this.turnWaiters.has(threadId)) {
            throw new Error(
                `해당 스레드에서 이미 턴이 실행 중입니다: ${threadId}`,
            );
        }

        const waiter = {
            turnId: null,
            chunks: [],
            resolve: null,
            reject: null,
        };

        const completion = new Promise((resolve, reject) => {
            waiter.resolve = resolve;
            waiter.reject = reject;
        });

        // turn/start 호출 전에 대기자를 등록해 완료 알림을 놓치지 않게 합니다.
        this.turnWaiters.set(threadId, waiter);

        try {
            const result = await this.request("turn/start", {
                threadId,
                input: [
                    {
                        type: "text",
                        text: prompt,
                    },
                ],
            });

            waiter.turnId = result.turn.id;

            // turn/completed가 turn/start 응답보다 먼저 도착한 경우도 고려합니다.
            if (waiter.completedTurn) {
                waiter.resolve(waiter.completedTurn);
            }

            const turn = await completion;

            const status = turn.status;

            if (status && status !== "completed") {
                throw new Error(`Codex 턴이 정상 완료되지 않았습니다: ${status}`);
            }

            let output = waiter.chunks.join("");

            // delta 알림이 없었던 경우 완료된 턴의 메시지를 확인합니다.
            if (!output && Array.isArray(turn.items)) {
                output = turn.items
                    .filter((item) =>
                        ["agentMessage", "assistantMessage"].includes(item.type),
                    )
                    .map((item) => item.text ?? "")
                    .filter(Boolean)
                    .join("\n");
            }

            if (!output.trim()) {
                throw new Error(
                    "Codex 턴은 완료되었지만 응답 본문을 확인하지 못했습니다.",
                );
            }

            return output.trim();
        } catch (error) {
            this.turnWaiters.delete(threadId);
            throw error;
        }
    }

    close() {
        if (!this.process) {
            return;
        }

        this.process.kill();
        this.process = null;
        this.initialized = false;
    }
}

const codex = new CodexAppServer();

async function synchronizeReferences(state, threadId, references) {
    let changed = false;

    for (const reference of references) {
        const previous = state.references?.[reference.name];

        if (previous?.hash === reference.hash) {
            continue;
        }

        log("INFO", `레퍼런스 변경 감지: ${reference.name}`);

        const prompt = [
            "중앙 설계 검토 에이전트의 참조 문서가 제공됩니다.",
            "아래 문서는 설계 검토의 기준입니다.",
            "문서 내용을 임의로 수정하거나 파일을 변경하지 마세요.",
            "이후 검토 요청에 이 기준을 적용하세요.",
            "",
            `문서명: ${reference.name}`,
            `경로: ${reference.path}`,
            "",
            "----- 문서 시작 -----",
            reference.content,
            "----- 문서 끝 -----",
            "",
            "문서를 읽고 검토 기준으로 수신했음을 간결하게 확인하세요.",
        ].join("\n");

        await codex.sendTurn(threadId, prompt);

        state.references ??= {};
        state.references[reference.name] = {
            path: reference.path,
            hash: reference.hash,
            synced: true,
            lastSyncedAt: new Date().toISOString(),
        };

        changed = true;
    }

    if (changed) {
        await saveState(state);
        log("INFO", "레퍼런스 동기화 완료");
    } else {
        log("INFO", "레퍼런스 변경 없음");
    }
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        const maxSize = 5 * 1024 * 1024;

        request.setEncoding("utf8");

        request.on("data", (chunk) => {
            size += Buffer.byteLength(chunk, "utf8");

            if (size > maxSize) {
                reject(new Error("요청 본문이 너무 큽니다. 최대 5MB입니다."));
                request.destroy();
                return;
            }

            body += chunk;
        });

        request.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("요청 본문이 올바른 JSON이 아닙니다."));
            }
        });

        request.on("error", reject);
    });
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
    });

    response.end(JSON.stringify(data));
}

function validateProjectName(projectName) {
    return (
        typeof projectName === "string" &&
        /^[a-zA-Z0-9._-]+$/.test(projectName) &&
        projectName !== "." &&
        projectName !== ".."
    );
}


async function saveReview(projectName, content) {
    const projectReviewDir = path.join(REVIEW_DIR, projectName);

    await ensureDirectory(projectReviewDir);

    const reviewPath = path.join(projectReviewDir, "review.md");
    const temporaryPath = `${reviewPath}.tmp`;

    let previousContent = "";

    try {
        previousContent = await readFile(reviewPath, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    const newEntry = content.trim();

    const combinedContent = previousContent.trim()
        ? `${previousContent.trimEnd()}\n\n---\n\n${newEntry}\n`
        : `${newEntry}\n`;

    await writeFile(temporaryPath, combinedContent, "utf8");
    await rename(temporaryPath, reviewPath);

    return reviewPath;
}

async function handleReviewRequest(request, response, state) {
    if (request.method !== "POST" || request.url !== "/review") {
        sendJson(response, 404, {
            success: false,
            error: "지원하지 않는 요청입니다.",
        });
        return;
    }

    let body;

    try {
        body = await readRequestBody(request);
    } catch (error) {
        sendJson(response, 400, {
            success: false,
            error: error.message,
        });
        return;
    }

    const {
        projectName,
        commitHash,
        parentHash,
        diff,
        changedFiles,
    } = body;

    if (!validateProjectName(projectName)) {
        sendJson(response, 400, {
            success: false,
            error: "유효하지 않은 projectName입니다.",
        });
        return;
    }

    if (typeof diff !== "string" || !diff.trim()) {
        sendJson(response, 400, {
            success: false,
            error: "검토할 diff가 없습니다.",
        });
        return;
    }

    if (!state.agent?.threadId || !codex.initialized) {
        sendJson(response, 503, {
            success: false,
            error: "중앙 Codex 에이전트가 초기화되지 않았습니다.",
        });
        return;
    }

    // 응답을 반환하기 전에 검토 작업을 큐에 등록합니다.
    const task = reviewQueue.then(async () => {
        const formatPath = path.join(
            REVIEW_DIR,
            projectName,
            "rough-review-rule.md",
        );

        const reviewFormat = await readFile(formatPath, "utf8");

        const prompt = [
            "기존 중앙 설계 검토 스레드에서 로컬 프로젝트의 커밋을 검토하세요.",
            "이미 주입된 중앙 설계 사상과 검토 규칙을 기준으로 판단하세요.",
            "",
            "검토 지침:",
            "1. 실제 diff에 나타난 변경만을 근거로 검토하세요.",
            "2. 설계 사상과 무관한 취향 차이를 결함으로 지적하지 마세요.",
            "3. 근거가 없는 문제, 파일, 동작, 성과를 만들어내지 마세요.",
            "4. 문제가 없으면 억지로 지적 사항을 만들지 마세요.",
            "5. 프로젝트의 검토 양식에 맞춰 결과를 작성하세요.",
            "6. 검토를 위해 프로젝트 파일을 수정하거나 커밋하지 마세요.",
            "7. 결과는 Markdown 본문으로만 반환하세요.",
            "",
            `프로젝트: ${projectName}`,
            `변경 전 커밋: ${parentHash || "(최초 커밋)"}`,
            `변경 후 커밋: ${commitHash ?? "(제공되지 않음)"}`,
            "",
            "----- 프로젝트별 검토 양식 시작 -----",
            reviewFormat,
            "----- 프로젝트별 검토 양식 끝 -----",
            "",
            "----- 변경 파일 -----",
            Array.isArray(changedFiles)
                ? changedFiles.join("\n")
                : "(제공되지 않음)",
            "----- 변경 파일 끝 -----",
            "",
            "----- Git diff 시작 -----",
            diff,
            "----- Git diff 끝 -----",
            "",
            "위 내용을 검토하고 검토 양식에 맞는 결과만 반환하세요.",
        ].join("\n");

        log("INFO", `검토 시작: ${projectName} / ${commitHash ?? "unknown"}`);

        const review = await codex.sendTurn(
            state.agent.threadId,
            prompt,
        );

        const reviewPath = await saveReview(projectName, review);

        log("INFO", `검토 결과 저장: ${reviewPath}`);

        return {
            projectName,
            commitHash: commitHash ?? null,
            reviewPath,
        };
    });

    // 실패한 작업이 다음 요청까지 막지 않도록 큐 체인을 복구합니다.
    reviewQueue = task.catch((error) => {
        log("ERROR", `검토 작업 실패: ${error.message}`);
    });

    try {
        const result = await task;

        sendJson(response, 200, {
            success: true,
            ...result,
        });
    } catch (error) {
        log("ERROR", `검토 요청 실패: ${error.stack ?? error.message}`);

        sendJson(response, 500, {
            success: false,
            error: error.message,
        });
    }
}

async function startHttpServer(state) {
    server = createServer(async (request, response) => {
        try {
            await handleReviewRequest(request, response, state);
        } catch (error) {
            log("ERROR", `HTTP 요청 처리 실패: ${error.message}`);

            if (!response.headersSent) {
                sendJson(response, 500, {
                    success: false,
                    error: "서버 내부 오류가 발생했습니다.",
                });
            } else {
                response.end();
            }
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);

        server.listen(PORT, HOST, () => {
            server.removeListener("error", reject);
            resolve();
        });
    });

    log("INFO", `검토 요청 서버: http://${HOST}:${PORT}/review`);
}

async function shutdown() {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    log("INFO", "에이전트 종료를 시작합니다.");

    if (server) {
        await new Promise((resolve) => {
            server.close(() => resolve());
        });
    }

    codex.close();

    log("INFO", "에이전트가 종료되었습니다.");
}

async function main() {
    const state = await loadState();
    const references = await loadReferences();

    await codex.start();

    const threadId = await codex.openThread(
        state.agent?.threadId,
    );

    state.agent = {
        initialized: true,
        threadId,
        lastStartedAt: new Date().toISOString(),
    };

    await synchronizeReferences(state, threadId, references);

    await saveState(state);

    log("INFO", "에이전트 초기화 완료");
    log("INFO", `Thread ID: ${threadId}`);
    log("INFO", `상태 파일: ${STATE_FILE}`);

    await startHttpServer(state);

    process.on("SIGINT", () => {
        void shutdown();
    });

    process.on("SIGTERM", () => {
        void shutdown();
    });

    log("INFO", "종료하려면 Ctrl+C를 누르세요.");
}

main().catch(async (error) => {
    log("ERROR", error.stack ?? error.message);
    await shutdown();
    process.exitCode = 1;
});
