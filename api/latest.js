export default async function handler(req, res) {
  try {
    // 오늘부터 최대 10일 전까지 확인
    const now = new Date();

    // 한국시간(KST) 기준 날짜 계산
    const kst = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul",
      })
    );

    for (let i = 0; i < 10; i++) {
      const target = new Date(kst);
      target.setDate(kst.getDate() - i);

      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const dd = String(target.getDate()).padStart(2, "0");

      const date = `${yyyy}${mm}${dd}`;

      // 이미 정상 작동 확인한 krx.js 호출
      const protocol =
        req.headers["x-forwarded-proto"] || "https";

      const host = req.headers.host;

      const url =
        `${protocol}://${host}/api/krx?date=${date}`;

      const response = await fetch(url);

      if (!response.ok) {
        continue;
      }

      const result = await response.json();

      const rows =
        result?.raw?.OutBlock_1 ||
        result?.data ||
        [];

      // 데이터가 있는 날짜 발견
      if (Array.isArray(rows) && rows.length > 0) {
        return res.status(200).json({
          ok: true,
          latestDate: date,
          count: rows.length,
          data: rows,
        });
      }
    }

    return res.status(404).json({
      ok: false,
      error: "최근 10일 이내 거래 데이터를 찾지 못했습니다.",
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
