export default async function handler(req, res) {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days || "20", 10), 1),
      30
    );

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;

    const now = new Date();

    // 한국시간 기준 오늘 날짜
    const kstNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul",
      })
    );

    const history = [];

    // 주말/공휴일을 고려해서 최대 45일 전까지 탐색
    for (let i = 0; i < 45 && history.length < days; i++) {
      const target = new Date(kstNow);
      target.setDate(kstNow.getDate() - i);

      // 토요일/일요일은 API 호출 자체를 생략
      const day = target.getDay();

      if (day === 0 || day === 6) {
        continue;
      }

      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const dd = String(target.getDate()).padStart(2, "0");

      const date = `${yyyy}${mm}${dd}`;

      try {
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

        // 실제 거래 데이터가 있는 날만 저장
        if (Array.isArray(rows) && rows.length > 0) {
          history.push({
            date,
            count: rows.length,
            data: rows,
          });
        }
      } catch (e) {
        // 특정 날짜 호출 실패 시 다음 날짜 계속 진행
        continue;
      }
    }

    if (history.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "거래 데이터를 찾지 못했습니다.",
      });
    }

    return res.status(200).json({
      ok: true,
      requestedDays: days,
      collectedDays: history.length,
      latestDate: history[0].date,
      oldestDate: history[history.length - 1].date,
      history,
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
