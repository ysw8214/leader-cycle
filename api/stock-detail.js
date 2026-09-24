export default async function handler(req, res) {
  try {
    const code = String(req.query.code || "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "종목코드(code)가 필요합니다."
      });
    }

    // 현재 배포된 사이트 주소 자동 인식
    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    const baseUrl = `${protocol}://${host}`;

    // 기존에 정상 작동 확인한 market-history 사용
    const historyUrl =
      `${baseUrl}/api/market-history?code=${encodeURIComponent(code)}&days=100`;

    const response = await fetch(historyUrl);

    if (!response.ok) {
      const text = await response.text();

      return res.status(500).json({
        ok: false,
        error: "market-history 호출 실패",
        detail: text
      });
    }

    const history = await response.json();

    if (!history.ok) {
      return res.status(500).json({
        ok: false,
        error: "종목 데이터를 가져오지 못했습니다.",
        detail: history
      });
    }

    const chart = Array.isArray(history.chart)
      ? history.chart
      : [];

    if (chart.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "차트 데이터가 없습니다."
      });
    }

    const latest = chart[0];
    const trend = history.trend || {};

    const price = Number(trend.price || latest.close || 0);
    const ma5 = Number(trend.ma5 || 0);
    const ma20 = Number(trend.ma20 || 0);
    const ma60 = Number(trend.ma60 || 0);

    /*
      완전 정배열
      현재가 > MA5 > MA20 > MA60
    */
    const alignment =
      price > ma5 &&
      ma5 > ma20 &&
      ma20 > ma60;

    /*
      정배열 진입 직전

      MA5 > MA20
      MA20 상승
      현재가 MA60 위
      MA20이 MA60 아래지만 3% 이내
    */
    let nearAlignment = false;
    let ma20To60Gap = null;

    if (ma20 > 0 && ma60 > 0) {
      ma20To60Gap =
        ((ma20 - ma60) / ma60) * 100;

      nearAlignment =
        !alignment &&
        ma5 > ma20 &&
        trend.ma20Rising === true &&
        price > ma60 &&
        ma20To60Gap >= -3;
    }

    /*
      추세 점수
      최대 40점
    */
    let trendScore = 0;

    if (price > ma20) trendScore += 8;
    if (price > ma60) trendScore += 8;
    if (ma5 > ma20) trendScore += 8;
    if (trend.ma20Rising) trendScore += 8;
    if (trend.ma60Rising) trendScore += 8;

    /*
      정배열 점수
      최대 25점
    */
    let alignmentScore = 0;

    if (alignment) {
      alignmentScore = 25;
    } else if (nearAlignment) {
      alignmentScore = 18;
    } else if (ma5 > ma20) {
      alignmentScore = 8;
    }

    /*
      당일 모멘텀
      최대 15점
    */
    const changeRate =
      Number(latest.changeRate || 0);

    let momentumScore = 0;

    if (changeRate >= 10) {
      momentumScore = 15;
    } else if (changeRate >= 5) {
      momentumScore = 12;
    } else if (changeRate >= 2) {
      momentumScore = 8;
    } else if (changeRate > 0) {
      momentumScore = 4;
    }

    /*
      거래대금 점수
      최대 20점
    */
    const tradingValue =
      Number(latest.tradingValue || 0);

    let liquidityScore = 0;

    if (tradingValue >= 500000000000) {
      liquidityScore = 20;
    } else if (tradingValue >= 200000000000) {
      liquidityScore = 16;
    } else if (tradingValue >= 100000000000) {
      liquidityScore = 12;
    } else if (tradingValue >= 50000000000) {
      liquidityScore = 8;
    } else if (tradingValue >= 10000000000) {
      liquidityScore = 4;
    }

    const leaderScore =
      trendScore +
      alignmentScore +
      momentumScore +
      liquidityScore;

    let stage = "WEAK";

    if (alignment && trend.ma20Rising && trend.ma60Rising) {
      stage = "LEADER";
    } else if (alignment) {
      stage = "ALIGNMENT";
    } else if (nearAlignment) {
      stage = "EARLY";
    } else if (
      price > ma20 &&
      trend.ma20Rising
    ) {
      stage = "WATCH";
    }

    return res.status(200).json({
      ok: true,

      code,
      name: history.name,
      latestDate: history.latestDate,

      price,
      changeRate,

      movingAverage: {
        ma5,
        ma20,
        ma60
      },

      trend: {
        alignment,
        nearAlignment,

        ma20Rising:
          trend.ma20Rising === true,

        ma60Rising:
          trend.ma60Rising === true,

        priceAbove20:
          price > ma20,

        priceAbove60:
          price > ma60,

        ma20To60Gap:
          ma20To60Gap !== null
            ? Number(ma20To60Gap.toFixed(2))
            : null
      },

      score: {
        total: leaderScore,
        trend: trendScore,
        alignment: alignmentScore,
        momentum: momentumScore,
        liquidity: liquidityScore
      },

      stage,

      market: {
        tradingValue,
        volume:
          Number(latest.volume || 0),

        marketCap:
          Number(latest.marketCap || 0)
      },

      // 실제 차트 그릴 때 사용할 데이터
      chart: chart.map(item => ({
        date: item.date,
        open: Number(item.open || 0),
        high: Number(item.high || 0),
        low: Number(item.low || 0),
        close: Number(item.close || 0),
        volume: Number(item.volume || 0),

        ma5:
          item.ma5 == null
            ? null
            : Number(item.ma5),

        ma20:
          item.ma20 == null
            ? null
            : Number(item.ma20),

        ma60:
          item.ma60 == null
            ? null
            : Number(item.ma60)
      }))
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
