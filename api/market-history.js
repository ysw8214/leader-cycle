module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 없습니다."
      });
    }

    // 기본 테스트 종목: 삼성전자
    const code = String(req.query.code || "005930");

    // 최대 120거래일
    const wantedDays = Math.min(
      Math.max(parseInt(req.query.days || "120", 10), 5),
      120
    );

    const now = new Date();

    const kstNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul"
      })
    );

    // 120거래일 확보를 위해 약 190일 후보 생성
    const candidateDates = [];

    for (let i = 0; i < 190; i++) {
      const target = new Date(kstNow);
      target.setDate(kstNow.getDate() - i);

      const day = target.getDay();

      // 주말 제외
      if (day === 0 || day === 6) continue;

      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const dd = String(target.getDate()).padStart(2, "0");

      candidateDates.push(`${yyyy}${mm}${dd}`);
    }

    async function fetchDay(date) {
      try {
        const url =
          `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${date}`;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            AUTH_KEY: apiKey
          }
        });

        if (!response.ok) return null;

        const json = await response.json();

        if (!Array.isArray(json.OutBlock_1)) {
          return null;
        }

        // 해당 날짜에서 요청 종목만 찾음
        const row = json.OutBlock_1.find((item) => {
          const shortCode =
            item.ISU_SRT_CD ||
            item.ISU_CD ||
            "";

          return (
            shortCode === code ||
            shortCode.endsWith(code)
          );
        });

        if (!row) return null;

        return {
          date: row.BAS_DD,
          code: row.ISU_SRT_CD || code,
          name: row.ISU_NM,

          open: Number(row.TDD_OPNPRC || 0),
          high: Number(row.TDD_HGPRC || 0),
          low: Number(row.TDD_LWPRC || 0),
          close: Number(row.TDD_CLSPRC || 0),

          changeRate: Number(row.FLUC_RT || 0),

          volume: Number(row.ACC_TRDVOL || 0),
          tradingValue: Number(row.ACC_TRDVAL || 0),

          marketCap: Number(row.MKTCAP || 0)
        };

      } catch (error) {
        return null;
      }
    }

    const records = [];

    // 10일씩 병렬 처리
    const batchSize = 10;

    for (
      let i = 0;
      i < candidateDates.length &&
      records.length < wantedDays;
      i += batchSize
    ) {
      const batch = candidateDates.slice(
        i,
        i + batchSize
      );

      const results = await Promise.all(
        batch.map(fetchDay)
      );

      for (const result of results) {
        if (result) records.push(result);

        if (records.length >= wantedDays) break;
      }
    }

    // 최신 → 과거
    records.sort(
      (a, b) => b.date.localeCompare(a.date)
    );

    const selected = records.slice(0, wantedDays);

    if (selected.length < 5) {
      return res.status(404).json({
        ok: false,
        code,
        error: "충분한 종목 데이터를 찾지 못했습니다.",
        collectedDays: selected.length
      });
    }

    // ----------------------------
    // 이동평균 계산
    // ----------------------------

    function movingAverage(index, period) {
      const slice = selected.slice(
        index,
        index + period
      );

      if (slice.length < period) return null;

      const sum = slice.reduce(
        (total, row) => total + row.close,
        0
      );

      return sum / period;
    }

    const chart = selected.map((row, index) => {
      const ma5 = movingAverage(index, 5);
      const ma20 = movingAverage(index, 20);
      const ma60 = movingAverage(index, 60);

      return {
        ...row,

        ma5:
          ma5 === null
            ? null
            : Math.round(ma5 * 100) / 100,

        ma20:
          ma20 === null
            ? null
            : Math.round(ma20 * 100) / 100,

        ma60:
          ma60 === null
            ? null
            : Math.round(ma60 * 100) / 100
      };
    });

    const latest = chart[0];

    const alignment =
      latest.ma5 !== null &&
      latest.ma20 !== null &&
      latest.ma60 !== null &&
      latest.ma5 > latest.ma20 &&
      latest.ma20 > latest.ma60;

    // 20MA 방향 확인
    let ma20Rising = false;

    if (
      chart[0]?.ma20 !== null &&
      chart[5]?.ma20 !== null
    ) {
      ma20Rising =
        chart[0].ma20 > chart[5].ma20;
    }

    // 60MA 방향 확인
    let ma60Rising = false;

    if (
      chart[0]?.ma60 !== null &&
      chart[5]?.ma60 !== null
    ) {
      ma60Rising =
        chart[0].ma60 > chart[5].ma60;
    }

    return res.status(200).json({
      ok: true,

      code,
      name: latest.name,

      requestedDays: wantedDays,
      collectedDays: selected.length,

      latestDate: latest.date,

      trend: {
        price: latest.close,

        ma5: latest.ma5,
        ma20: latest.ma20,
        ma60: latest.ma60,

        alignment,
        ma20Rising,
        ma60Rising,

        priceAbove20:
          latest.ma20 !== null
            ? latest.close > latest.ma20
            : false,

        priceAbove60:
          latest.ma60 !== null
            ? latest.close > latest.ma60
            : false
      },

      chart
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: String(error),
      stack: error?.stack || null
    });
  }
};
