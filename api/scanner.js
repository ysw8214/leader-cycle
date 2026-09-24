module.exports = async function handler(req, res) {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days || "5", 10), 1),
      10
    );

    // 이미 정상 작동 확인된 history API 호출
    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const historyUrl =
      `${protocol}://${host}/api/history?days=${days}`;

    const response = await fetch(historyUrl);

    if (!response.ok) {
      const text = await response.text();

      return res.status(500).json({
        ok: false,
        step: "history_fetch",
        status: response.status,
        detail: text
      });
    }

    const history = await response.json();

    if (!history.ok || !Array.isArray(history.history)) {
      return res.status(500).json({
        ok: false,
        step: "history_parse",
        received: history
      });
    }

    // 종목별 데이터 정리
    const stocks = {};

    history.history.forEach((day) => {
      if (!Array.isArray(day.data)) return;

      day.data.forEach((stock) => {
        const code = stock.ISU_CD;
        if (!code) return;

        if (!stocks[code]) {
          stocks[code] = {
            code,
            name: stock.ISU_NM,
            market: stock.MKT_NM,
            records: []
          };
        }

        stocks[code].records.push({
          date: stock.BAS_DD,
          close: Number(stock.TDD_CLSPRC || 0),
          changeRate: Number(stock.FLUC_RT || 0),
          volume: Number(stock.ACC_TRDVOL || 0),
          value: Number(stock.ACC_TRDVAL || 0),
          marketCap: Number(stock.MKTCAP || 0)
        });
      });
    });

    // 간단한 Leader Cycle 점수 계산
    const result = Object.values(stocks)
      .map((stock) => {
        const records = stock.records;

        if (!records.length) return null;

        const latest = records[0];

        const avgValue =
          records.reduce((sum, r) => sum + r.value, 0) /
          records.length;

        const avgVolume =
          records.reduce((sum, r) => sum + r.volume, 0) /
          records.length;

        const valueRatio =
          avgValue > 0
            ? latest.value / avgValue
            : 0;

        const volumeRatio =
          avgVolume > 0
            ? latest.volume / avgVolume
            : 0;

        const momentum = latest.changeRate;

        // 임시 Leader Cycle 점수
        const score =
          momentum * 10 +
          Math.min(valueRatio, 5) * 10 +
          Math.min(volumeRatio, 5) * 5;

        return {
          code: stock.code,
          name: stock.name,
          market: stock.market,
          close: latest.close,
          changeRate: latest.changeRate,
          tradingValue: latest.value,
          volume: latest.volume,
          marketCap: latest.marketCap,
          valueRatio: Number(valueRatio.toFixed(2)),
          volumeRatio: Number(volumeRatio.toFixed(2)),
          score: Number(score.toFixed(2))
        };
      })
      .filter(Boolean)
      .filter((stock) => stock.tradingValue > 0)
      .sort((a, b) => b.score - a.score);

    const leaders = result.slice(0, 20);

    return res.status(200).json({
      ok: true,
      days,
      latestDate: history.latestDate,
      stockCount: result.length,
      leaders
    });

  } catch (error) {
    console.error("SCANNER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: String(error),
      stack: error?.stack || null
    });
  }
};
