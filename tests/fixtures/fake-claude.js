// A stand-in for `claude -p --input-format stream-json --output-format stream-json` used by the web app tests.
// First user message: init line, the text echoed back as two text deltas, a Bash tool_use, a can_use_tool ask (r1);
// after the answer, "allowed" or "denied", then a result. Later user messages are echoed and get a result each.
// Exits 0 when stdin closes. FAKE_HANG=1: never answers. FAKE_FAIL=1: writes to stderr and exits 3.
// FAKE_TOOL=<name>: the ask is for that tool instead of Bash. FAKE_SPLIT=1: the first delta's bytes arrive split
// in the middle of a multibyte character.
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const args = process.argv.slice(2);
const resumeAt = args.indexOf("--resume");
const session = resumeAt >= 0 ? args[resumeAt + 1] : "fake-1";
const delta = (text) => out({ type: "stream_event", session_id: session,
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const result = (text) => out({ type: "result", subtype: "success", is_error: false, result: text, session_id: session });

if (process.env.FAKE_FAIL) {
  process.stderr.write("boom: something broke\nsecond line\n");
  process.exit(3);
}
if (process.env.FAKE_ARGS) out({ type: "system", subtype: "args", args });

let buf = "", turn = 0, waiting = false;
process.stdin.on("data", (d) => {
  buf += d;
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === "control_response" && waiting) {
      waiting = false;
      delta(msg.response.response.behavior === "allow" ? "allowed" : "denied");
      result("done");
    } else if (msg.type === "user") {
      const text = msg.message.content[0].text;
      turn++;
      if (turn === 1) out({ type: "system", subtype: "init", session_id: session });
      if (process.env.FAKE_HANG) continue;
      if (process.env.FAKE_SPLIT && turn === 1) {
        const bytes = Buffer.from(JSON.stringify({ type: "stream_event", session_id: session,
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "é—" } } }) + "\n");
        const cut = bytes.indexOf(Buffer.from("é")) + 1;
        process.stdout.write(bytes.subarray(0, cut));
        setTimeout(() => process.stdout.write(bytes.subarray(cut)), 50);
        setTimeout(() => result("ok"), 100);
        continue;
      }
      delta("echo: " + text.slice(0, 3));
      delta(text.slice(3));
      if (turn === 1 && resumeAt < 0) {
        out({ type: "assistant", session_id: session, message: { content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hi" } }] } });
        out({ type: "control_request", request_id: "r1",
          request: { subtype: "can_use_tool", tool_name: process.env.FAKE_TOOL || "Bash", input: { command: "echo hi" } } });
        waiting = true;
      } else {
        result("ok");
      }
    }
  }
});
process.stdin.on("end", () => process.exit(0));
