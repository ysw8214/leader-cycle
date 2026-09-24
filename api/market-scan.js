module.exports = async function handler(req, res) {
  try {
    /* ==========================================
       LEADER CYCLE - FAST MARKET SCANNER v1

       목적
       1. 최신 시장 전체 조회
       2. 투자 가능성이 낮은 종목 제거
       3. 정밀 분석 후보군 생성
       4. 후보만 stock-detail에서 분석

       중요:
       여기서는 942종목 × 100일 조회를 하지 않는다.
    ========================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const num = value => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    const clamp = (value, min, max) =>
      Math.max(min, Math.min(max, value));

    /* ==========================================
       날짜 처리

       date가 있으면 해당 날짜 사용
       없으면 최근 영업일 후보를 역순 탐색
    ========================================== */

    const requestedDate =
      String(req.query.date || "").trim();

    const makeDate = date => {
      const y = date.getFullYear();
      const m = String(
        date.getMonth() + 1
      ).padStart(2, "0");
      const d = String(
        date.getDate()
      ).padStart(2, "0");

      return `${y}${m}${d}`;
    };

    let snapshot = null;
    let usedDate = null;

    /* ==========================================
       SNAPSHOT 호출 함수
    ========================================== */

    async function getSnapshot(date) {
      try {
        const url =
          `${baseUrl}/api/market-snapshot?date=${date}`;

        const response = await fetch(url);

        if (!response.ok) return null;

        const json = await response.json();

        if (
          !json.ok ||
          !Array.isArray(json.stocks) ||
          json.stocks.length === 0
        ) {
          return null;
        }

        return json;

      } catch {
        return null;
      }
    }

    /* ==========================================
       날짜 직접 지정
    ========================================== */

    if (/^\d{8}$/.test(requestedDate)) {

      snapshot =
        await getSnapshot(requestedDate);

      usedDate = requestedDate;

    } else {

      /*
        한국시간 기준 최근 날짜 탐색

        휴일을 고려해서 최대 10일 뒤로 검색
      */

      const now = new Date();

      const korea = new Date(
        now.toLocaleString(
          "en-US",
          {
            timeZone: "Asia/Seoul"
          }
        )
      );

      for (let i = 0; i < 10; i++) {

        const target =
          new Date(korea);

        target.setDate(
          korea.getDate() - i
        );

        const day =
          target.getDay();

        // 토/일 제외
        if (
          day === 0 ||
          day === 6
        ) {
          continue;
        }

        const date =
          makeDate(target);

        const result =
          await getSnapshot(date);

        if (result) {
          snapshot = result;
          usedDate = date;
          break;
        }
      }
    }

    if (!snapshot) {
      return res.status(404).json({
        ok: false,
        error:
          "최근 시장 데이터를 찾지 못했습니다."
      });
    }

    /* ==========================================
       기본 데이터 정리
    ========================================== */

    const allStocks =
      snapshot.stocks
        .map(stock => ({
          code:
            String(stock.code || "")
              .trim(),

          name:
            String(stock.name || "")
              .trim(),

          close:
            num(stock.close),

          changeRate:
            num(stock.changeRate),

          volume:
            num(stock.volume),

          tradingValue:
            num(stock.tradingValue),

          marketCap:
            num(stock.marketCap)
        }))
        .filter(stock =>
          /^\d{6}$/.test(stock.code) &&
          stock.close > 0
        );

    /* ==========================================
       1차 INVESTABLE FILTER

       너무 작은 종목 / 거래대금 부족 종목 제거

       현재 기준:
       시가총액 1,000억원 이상
       거래대금 30억원 이상
    ========================================== */

    const MIN_MARKET_CAP =
      100000000000;

    const MIN_TRADING_VALUE =
      3000000000;

    const investable =
      allStocks.filter(stock =>
        stock.marketCap >=
          MIN_MARKET_CAP &&

        stock.tradingValue >=
          MIN_TRADING_VALUE
      );

    /* ==========================================
       시장 내 상대 순위 계산

       절대 거래대금만 보는 것보다
       "오늘 시장에서 얼마나 돈이 몰렸는가"
       판단하기 위한 값
    ========================================== */

    const valueSorted =
      [...investable]
        .sort(
          (a, b) =>
            b.tradingValue -
            a.tradingValue
        );

    const changeSorted =
      [...investable]
        .sort(
          (a, b) =>
            b.changeRate -
            a.changeRate
        );

    const valueRank = new Map();
    const changeRank = new Map();

    valueSorted.forEach(
      (stock, index) => {
        valueRank.set(
          stock.code,
          index
        );
      }
    );

    changeSorted.forEach(
      (stock, index) => {
        changeRank.set(
          stock.code,
          index
        );
      }
    );

    const total =
      Math.max(
        investable.length,
        1
      );

    /* ==========================================
       DISCOVERY SCORE

       이것은 최종 Leader Score가 아니다.

       목적:
       "정밀 분석할 가치가 있는 종목인가?"

       구성:
       거래대금 상대강도 45
       당일 가격강도     25
       절대 유동성       20
       시가총액 안정성   10

       최대 100
    ========================================== */

    const candidates =
      investable.map(stock => {

        /* ------------------------------
           거래대금 시장 상대순위
           최대 45
        ------------------------------ */

        const vr =
          valueRank.get(
            stock.code
          ) ?? total;

        const valuePercentile =
          1 -
          vr / total;

        const valueScore =
          clamp(
            valuePercentile * 45,
            0,
            45
          );

        /* ------------------------------
           당일 가격 강도
           최대 25

           너무 급등했다고 무조건
           높은 점수를 주지는 않음.
        ------------------------------ */

        let priceScore = 0;

        if (
          stock.changeRate >= 2 &&
          stock.changeRate < 5
        ) {
          priceScore = 15;
        }

        else if (
          stock.changeRate >= 5 &&
          stock.changeRate < 10
        ) {
          priceScore = 21;
        }

        else if (
          stock.changeRate >= 10 &&
          stock.changeRate < 20
        ) {
          priceScore = 25;
        }

        else if (
          stock.changeRate >= 0 &&
          stock.changeRate < 2
        ) {
          priceScore = 8;
        }

        else if (
          stock.changeRate >= 20
        ) {
          /*
            상한가/급등 종목은 발견 후보에는
            포함시키되 신규진입 판단은
            stock-detail에서 별도 처리
          */
          priceScore = 20;
        }

        else if (
          stock.changeRate > -2
        ) {
          priceScore = 3;
        }

        /* ------------------------------
           절대 거래대금
           최대 20
        ------------------------------ */

        let liquidityScore = 0;

        if (
          stock.tradingValue >=
          500000000000
        ) {
          liquidityScore = 20;
        }

        else if (
          stock.tradingValue >=
          200000000000
        ) {
          liquidityScore = 17;
        }

        else if (
          stock.tradingValue >=
          100000000000
        ) {
          liquidityScore = 14;
        }

        else if (
          stock.tradingValue >=
          50000000000
        ) {
          liquidityScore = 11;
        }

        else if (
          stock.tradingValue >=
          20000000000
        ) {
          liquidityScore = 8;
        }

        else if (
          stock.tradingValue >=
          10000000000
        ) {
          liquidityScore = 5;
        }

        else {
          liquidityScore = 2;
        }

        /* ------------------------------
           시총
           최대 10

           대형주만 뽑는 것이 아니라
           최소 안정성만 반영
        ------------------------------ */

        let capScore = 0;

        if (
          stock.marketCap >=
          10000000000000
        ) {
          capScore = 10;
        }

        else if (
          stock.marketCap >=
          5000000000000
        ) {
          capScore = 9;
        }

        else if (
          stock.marketCap >=
          1000000000000
        ) {
          capScore = 7;
        }

        else if (
          stock.marketCap >=
          500000000000
        ) {
          capScore = 5;
        }

        else {
          capScore = 3;
        }

        const discoveryScore =
          Math.round(
            valueScore +
            priceScore +
            liquidityScore +
            capScore
          );

        const cr =
          changeRank.get(
            stock.code
          ) ?? total;

        const reasons = [];

        if (
          valuePercentile >= 0.95
        ) {
          reasons.push(
            "시장 거래대금 상위 5%"
          );
        }

        else if (
          valuePercentile >= 0.9
        ) {
          reasons.push(
            "시장 거래대금 상위 10%"
          );
        }

        if (
          stock.changeRate >= 5
        ) {
          reasons.push(
            "강한 가격 모멘텀"
          );
        }

        if (
          stock.tradingValue >=
          100000000000
        ) {
          reasons.push(
            "1,000억원 이상 거래대금"
          );
        }

        return {
          code:
            stock.code,

          name:
            stock.name,

          discoveryScore,

          changeRate:
            stock.changeRate,

          close:
            stock.close,

          tradingValue:
            stock.tradingValue,

          marketCap:
            stock.marketCap,

         
