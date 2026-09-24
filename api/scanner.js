export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 설정되지 않았습니다.",
      });
    }

    // 테스트 시 ?days=5
    // 최종적으로 ?days=20
    const requestedDays = Math.min(
      Math.max(parseInt(req.query.days || "5", 10), 3),
      20
    );

    const num = (value) => {
      const n = Number(String(value ?? "").replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    };

    const avg = (arr) => {
      if (!arr.length) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    // ─────────────────────────────
    // 한국시간 기준 날짜 후보 생성
    // ─────────────────────────────

    const now = new Date();

    const kstNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul",
      })
    );

    const candidateDates = [];

    // 20거래일 확보를 위해 넉넉히 35일 탐색
    for (let i = 0; i < 35; i++) {
      const target = new Date(kstNow);

      target.setDate(kstNow.getDate() - i);

      const day = target.getDay();

      // 토/일 제외
      if (day === 0 || day === 6) {
        continue;
      }

      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const dd = String(target.getDate()).padStart(2, "0");

      candidateDates.push(`${yyyy}${mm}${dd}`);
    }

    // ─────────────────────────────
    // KRX 직접 호출 함수
    // ─────────────────────────────

    async function fetchKRX(date) {
      try {
        const url =
          "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

        // 지금 정상 작동 중인 krx.js와 동일하게 GET 방식
        const response = await fetch(
          `${url}?basDd=${date}`,
          {
            method: "GET",
            headers: {
              AUTH_KEY: apiKey,
            },
          }
        );

        if (!response.ok) {
          return null;
        }

        const json = await response.json();

        const rows = json?.OutBlock_1;

        if (!Array.isArray(rows) || rows.length === 0) {
         
