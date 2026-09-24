module.exports = async function handler(req, res) {
  try {
    const code = String(req.query.code || "005930").trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error: "6자리 종목코드(code)가 필요합니다."
      });
    }

    const wantedDays = Math.min(
      Math.max(parseInt(req.query.days || "100", 10), 5),
      120
    );

    /*
      ==========================================
      CACHE
      ==========================================
    */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=86400"
    );

    /*
      현재 사이트 주소 자동 인식
    */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const baseUrl = `${protocol}://${host}`;

    /*
      ==========================================
      후보 날짜 생성

      120 거래일 확보를 위해
      약 190일 범위 확인
      ==========================================
    */

    const now = new Date();

    const kstNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul"
      })
    );

    const candidateDates = [];

    for (let i = 0; i < 190; i++) {
      const target = new Date(kstNow);

      target.setDate(
        kstNow.getDate() - i
      );

      const day = target.getDay();

      if (day === 0 || day === 6) {
        continue;
      }

      const yyyy = target.getFullYear();

      const mm = String(
        target.getMonth() + 1
      ).padStart(2, "0");

      const dd = String(
        target.getDate()
      ).padStart(2, "0");

      candidateDates.push(
        `${yyyy}${mm}${dd}`
      );
    }

    /*
      ==========================================
      하루 전체시장 SNAPSHOT 호출

      여기서 중요한 점:
      KRX를 직접 호출하지 않는다.

      market-snapshot이 날짜별 전체시장을
      가져오고 CDN 캐시한다.
      ==========================================
    */

    async function fetchSnapshot(date) {
      try {
        const url =
          `${baseUrl}/api/market-snapshot?date=${date}`;

        const response = await fetch(url);

        if (!response.ok) {
          return null;
        }

        const json = await response.json();

        if (
          !json.ok ||
          !Array.isArray(json.stocks)
        ) {
          return null;
        }

        /*
          전체 942개를 history에 저장하지 않고
          여기서 필요한 종목 하나만 추출
        */

        const row = json.stocks.find(item => {
          const stockCode =
            String(item.code || "");

          return (
            stockCode === code ||
            stockCode.endsWith(code)
          );
        });

        if (!row) {
          return null;
        }

        return {
          date: row.date,
          code,
          name: row.name,

          open: Number(row.open || 0),
          high: Number(row.high || 0),
          low: Number(row.low || 0),
          close: Number(row.close || 0),

          changeRate:
            Number(row.changeRate || 0),

          volume:
            Number(row.volume || 0),

          tradingValue:
            Number(row.tradingValue || 0),

          marketCap:
            Number(row.marketCap || 0)
        };

      } catch (error) {
        return null;
      }
    }

    /*
      ==========================================
      SNAPSHOT 병렬 수집

      너무 많은 동시 요청을 피하기 위해
      20일 단위로 처리
      ==========================================
    */

    const records = [];

    const batchSize = 20;

    for (
      let i = 0;
      i < candidateDates.length &&
      records.length < wantedDays;
      i += batchSize
    ) {
      const batch =
        candidateDates.slice(
          i,
          i + batchSize
        );

      const results =
        await Promise.all(
          batch.map(fetchSnapshot)
        );

      for (const result of results) {
        if (result) {
          records.push(result);
        }

        if (
          records.length >= wantedDays
        ) {
          break;
        }
      }
    }

    /*
      최신 → 과거
    */

    records.sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    );

    const selected =
      records.slice(0, wantedDays);

    if (selected.length < 5) {
      return res.status(404).json({
        ok: false,
        code,
        error:
          "충분한 종목 데이터를 찾지 못했습니다.",
        collectedDays:
          selected.length
      });
    }

    /*
      ==========================================
      이동평균 계산

      selected 배열은
      최신 → 과거 순서
      ==========================================
    */

    function movingAverage(index, period) {
      const slice =
        selected.slice(
          index,
          index + period
        );

      if (slice.length < period) {
        return null;
      }

      const sum =
        slice.reduce(
          (total, row) =>
            total +
            Number(row.close || 0),
          0
        );

      return sum / period;
    }

    const chart =
      selected.map(
        (row, index) => {

          const ma5 =
            movingAverage(index, 5);

          const ma20 =
            movingAverage(index, 20);

          const ma60 =
            movingAverage(index, 60);

          return {
            ...row,

            ma5:
              ma5 === null
                ? null
                : Math.round(
                    ma5 * 100
                  ) / 100,

            ma20:
              ma20 === null
                ? null
                : Math.round(
                    ma20 * 100
                  ) / 100,

            ma60:
              ma60 === null
                ? null
                : Math.round(
                    ma60 * 100
                  ) / 100
          };
        }
      );

    const latest = chart[0];

    /*
      ==========================================
      정배열

      현재가 > MA5 > MA20 > MA60
      ==========================================
    */

    const alignment =
      latest.ma5 !== null &&
      latest.ma20 !== null &&
      latest.ma60 !== null &&
      latest.close > latest.ma5 &&
      latest.ma5 > latest.ma20 &&
      latest.ma20 > latest.ma60;

    /*
      MA20 상승 여부
      현재 MA20 vs 5거래일 전 MA20
    */

    let ma20Rising = false;

    if (
      chart[0]?.ma20 != null &&
      chart[5]?.ma20 != null
    ) {
      ma20Rising =
        chart[0].ma20 >
        chart[5].ma20;
    }

    /*
      MA60 상승 여부
    */

    let ma60Rising = false;

    if (
      chart[0]?.ma60 != null &&
      chart[5]?.ma60 != null
    ) {
      ma60Rising =
        chart[0].ma60 >
        chart[5].ma60;
    }

    /*
      ==========================================
      RESPONSE

      기존 score-engine.js와 호환
      ==========================================
    */

    return res.status(200).json({
      ok: true,

      source: "MARKET_SNAPSHOT",

      code,

      name: latest.name,

      requestedDays:
        wantedDays,

      collectedDays:
        selected.length,

      latestDate:
        latest.date,

      trend: {
        price:
          latest.close,

        ma5:
          latest.ma5,

        ma20:
          latest.ma20,

        ma60:
          latest.ma60,

        alignment,

        ma20Rising,

        ma60Rising,

        priceAbove20:
          latest.ma20 !== null
            ? latest.close >
              latest.ma20
            : false,

        priceAbove60:
          latest.ma60 !== null
            ? latest.close >
              latest.ma60
            : false
      },

      chart
    });

  } catch (error) {
    console.error(
      "MARKET HISTORY ERROR",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
