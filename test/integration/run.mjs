import { run as claim } from "./claim.mjs";
import { run as extension } from "./extension.mjs";

const API = process.env.API_URL || "http://localhost:4000";

try {
  const res = await fetch(API + "/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
} catch (e) {
  console.error(
    `\n❌ 서버(${API})에 연결할 수 없어요. 먼저 서버를 띄워주세요:\n` +
      `   yarn build && yarn start:dev\n   (${e.message})`,
  );
  process.exit(2);
}

let fail = 0;
fail += await claim();
fail += await extension();

console.log(
  fail ? `\n❌ 통합 테스트 실패 ${fail}건` : "\n✅ 통합 테스트 전부 통과",
);
process.exit(fail ? 1 : 0);
