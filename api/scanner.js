export default async function handler(req, res) {
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;

    // 20거래일 데이터 가져오기
    const historyUrl = `${protocol}://${host}/api/history?days=20`;
    const response = await fetch(historyUrl);

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: "history API 호출 실패",
        status: response.status,
      });
    }

    const result = await response.json();
    const history = result.history || [];

    if (history.length < 5) {
      return res.status(500).json({
        ok: false,
        error: "분석할 거래일 데이터가 부족합니다.",
        collectedDays: history.length,
      });
    }

    // 숫자 변환
    const num = (value) => {
      const n = Number(String(value ?? "").replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    };

    // 종목코드 기준으로 20일 데이터 묶기
    const stocks = new Map();

    history.forEach((day, dayIndex) => {
      (day.data || []).forEach((row) => {
        const code = row.ISU_CD;

        if (!code) return;

        if (!stocks.has(code)) {
          stocks.set(code, {
            code,
            name: row.ISU_NM,
            market: row.MKT_NM,
            days: [],
          });
        }

        stocks.get(code).days.push({
          dayIndex,
          date: day.date,
          close: num(row.TDD_CLSPRC),
          change: num(row.CMPPREVDD_PRC),
          changeRate: num(row.FLUC_RT),
          open: num(row.TDD_OPNPRC),
          high: num(row.TDD_HGPRC),
          low: num(row.TDD_LWPRC),
          volume: num(row.ACC_TRDVOL),
          tradingValue: num(row.ACC_TRDVAL),
          marketCap: num(row.MKTCAP),
        });
      });
    });

    const analyzed = [];

    stocks.forEach((stock) => {
      // 최신 → 과거 순서
      stock.days.sort((a, b) => a.dayIndex - b.dayIndex);

      const d = stock.days;

      if (d.length < 5) return;

      const latest = d[0];

      // 너무 거래가 적은 종목 제거
      if (latest.tradingValue < 500000000) return; // 5억원
      if (latest.marketCap < 30000000000) return;  // 300억원
      if (latest.close <= 0) return;

      const avg = (arr) => {
        if (!arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      };

      // ─────────────────────────
      // 수익률 계산
      // ─────────────────────────

      const returnFrom = (index) => {
        if (!d[index] || !d[index].close) return 0;

        return (
          ((latest.close - d[index].close) /
            d[index].close) *
          100
        );
      };

      const ret5 = returnFrom(Math.min(4, d.length - 1));
      const ret10 = returnFrom(Math.min(9, d.length - 1));
      const ret20 = returnFrom(Math.min(19, d.length - 1));

      // ─────────────────────────
      // 거래대금
      // ─────────────────────────

      const recentValue = avg(
        d.slice(0, Math.min(3, d.length))
          .map((x) => x.tradingValue)
      );

      const oldValueSlice =
        d.length >= 10
          ? d.slice(5, 10)
          : d.slice(Math.floor(d.length / 2));

      const oldValue = avg(
        oldValueSlice.map((x) => x.tradingValue)
      );

      const valueRatio =
        oldValue > 0 ? recentValue / oldValue : 1;

      // ─────────────────────────
      // 거래량
      // ─────────────────────────

      const recentVolume = avg(
        d.slice(0, Math.min(3, d.length))
          .map((x) => x.volume)
      );

      const oldVolume = avg(
        oldValueSlice.map((x) => x.volume)
      );

      const volumeRatio =
        oldVolume
