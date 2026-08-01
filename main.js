// ==========================================
// FALLBACK CONFIGURATION
// (Used if GPS permissions are denied/offline)
// ==========================================
const FALLBACK_NAME = "Lund";
const FALLBACK_LAT = 55.7047;
const FALLBACK_LON = 13.191;

// ==========================================
// SHARED CHART DIMENSIONS & PROPORTIONS
// ==========================================
const CHART_WIDTH = 1072;
const CHART_HEIGHT = 178;
const CHART_LEFT_AXIS_WIDTH = 58;
const CHART_RIGHT_AXIS_WIDTH = 68;

// ==========================================
// DYNAMIC DEVICE SCREEN SIZING
// ==========================================
function getWidgetContentWidth() {
  const screenW = Device.screenSize().width;
  const screenH = Device.screenSize().height;
  const minDim = Math.min(screenW, screenH);

  // Exact iOS Medium Widget content widths after 20pt total horizontal padding:
  // Plus / Pro Max (430, 428 pt) -> 364 pt - 20 = 344 pt
  // Standard / Pro (393, 390 pt) -> 338 pt - 20 = 318 pt
  // Older Large (414 pt)         -> 360 pt - 20 = 340 pt
  // Mini / Compact (375, 360 pt) -> 329 pt - 20 = 309 pt
  if (minDim >= 428) return 344;
  if (minDim >= 414) return 340;
  if (minDim >= 390) return 318;
  return 309;
}

// ==========================================
// CACHE HELPERS
// ==========================================
const cachePath = FileManager.local().joinPath(
  FileManager.local().cacheDirectory(),
  "smhi-chart-widget-cache.json",
);

function saveCache(data) {
  try {
    FileManager.local().writeString(cachePath, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save cache: " + e);
  }
}

function loadCache() {
  const fm = FileManager.local();
  if (fm.fileExists(cachePath)) {
    try {
      const raw = fm.readString(cachePath);
      return JSON.parse(raw);
    } catch (e) {
      console.error("Failed to read cache: " + e);
      return null;
    }
  }
  return null;
}

// ==========================================
// RUN WIDGET
// ==========================================
const widget = await createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();

// ==========================================
// WIDGET BUILDER
// ==========================================
async function createWidget() {
  const widget = new ListWidget();
  widget.setPadding(10, 3, 10, 3);

  // Light Mode: White background | Dark Mode: Pure Black background
  widget.backgroundColor = Color.dynamic(
    new Color("#FFFFFF"),
    new Color("#000000"),
  );

  let lat = FALLBACK_LAT;
  let lon = FALLBACK_LON;
  let locationName = FALLBACK_NAME;
  let timeSeries = [];
  let fetchTimeStr = "";

  try {
    // 1. Fetch GPS Location & City Name
    try {
      const loc = await Location.current();
      lat = loc.latitude;
      lon = loc.longitude;
      const placemarks = await Location.reverseGeocode(lat, lon);
      if (placemarks && placemarks.length > 0) {
        locationName =
          placemarks[0].locality ||
          placemarks[0].postalAddress?.city ||
          locationName;
      }
    } catch (e) {
      console.log("GPS fetch failed, using fallback location: " + e);
    }

    // 👉 MAKE WIDGET TAPPABLE (Opens SMHI forecast)
    widget.url = `https://www.smhi.se/vader/prognoser-och-varningar/vaderprognos`;

    // 2. Fetch SMHI API Data
    const apiUrl = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;
    const req = new Request(apiUrl);
    const data = await req.loadJSON();

    timeSeries = data?.timeSeries || [];
    if (!Array.isArray(timeSeries) || timeSeries.length === 0) {
      throw new Error("No timeSeries in SMHI response");
    }

    fetchTimeStr = formatTime(new Date());

    // Save successful fetch to disk
    saveCache({
      lat,
      lon,
      locationName,
      timeSeries,
      fetchTimeStr,
      url: widget.url,
    });
  } catch (e) {
    console.error("Update failed, falling back to cache: " + e);
    const cached = loadCache();

    if (
      cached &&
      Array.isArray(cached.timeSeries) &&
      cached.timeSeries.length > 0
    ) {
      lat = cached.lat || FALLBACK_LAT;
      lon = cached.lon || FALLBACK_LON;
      locationName = cached.locationName || FALLBACK_NAME;
      timeSeries = cached.timeSeries;
      fetchTimeStr = cached.fetchTimeStr || "Unknown";
      if (cached.url) widget.url = cached.url;
    } else {
      const errText = widget.addText("Failed to load SMHI data");
      errText.textColor = Color.red();
      errText.font = Font.boldSystemFont(12);
      return widget;
    }
  }

  // 3. TITLE ROW
  const contentWidth = getWidgetContentWidth();
  const titleLeftInset = contentWidth * (CHART_LEFT_AXIS_WIDTH / CHART_WIDTH);
  const titleRightInset = contentWidth * (CHART_RIGHT_AXIS_WIDTH / CHART_WIDTH);

  const titleStack = widget.addStack();
  titleStack.layoutHorizontally();
  titleStack.centerAlignContent();
  titleStack.setPadding(0, 4, 0, 4);

  titleStack.addSpacer(titleLeftInset);

  const titleText = titleStack.addText(locationName);
  titleText.font = Font.boldSystemFont(13);
  titleText.textColor = defaultColor();

  titleStack.addSpacer();

  const timeText = titleStack.addText(`Updated ${fetchTimeStr}`);
  timeText.font = Font.systemFont(10);
  timeText.textColor = subtitleColor();

  titleStack.addSpacer(titleRightInset);

  widget.addSpacer(4);

  // 4. FORECAST TEXT ROWS (NATIVE WIDGET STACK)
  const forecasts = getUpcomingHours(timeSeries, 16);

  if (forecasts.length === 0) {
    const errText = widget.addText("No upcoming forecast data");
    errText.textColor = Color.orange();
    errText.font = Font.boldSystemFont(12);
    return widget;
  }

  const colWidthPt =
    (contentWidth - titleLeftInset - titleRightInset) / forecasts.length;

  // Outer row centers the forecast block in the widget — exactly the same
  // spacer/content/spacer pattern used for the chart image below — so the
  // two rows are centered identically and stay locked together instead of
  // one being flush-left and the other auto-centered.
  const forecastRow = widget.addStack();
  forecastRow.layoutHorizontally();
  forecastRow.addSpacer();

  const forecastStack = forecastRow.addStack();
  forecastStack.layoutHorizontally();
  forecastStack.centerAlignContent();
  forecastStack.spacing = 0; // Exactly 0 horizontal spacing between columns
  forecastStack.size = new Size(contentWidth, 54); // Same width as the chart image below

  // Left inset aligns column 0 center over the first dot of the probability curve
  forecastStack.addSpacer(titleLeftInset);

  for (let i = 0; i < forecasts.length; i++) {
    const item = forecasts[i];
    const itemTime = new Date(item.time || item.validTime);

    const colStack = forecastStack.addStack();
    colStack.layoutVertically();
    colStack.centerAlignContent();
    colStack.spacing = 1;
    // Identical fixed point size guarantees mathematical alignment without UIKit flex drift
    colStack.size = new Size(colWidthPt, 54);

    // Hour — a fixed-width row with flexible spacers on both sides. The
    // spacers split the leftover space evenly, which is what actually
    // centers the text (WidgetText has no .size of its own to anchor to).
    const hourRow = colStack.addStack();
    hourRow.layoutHorizontally();
    hourRow.centerAlignContent();
    hourRow.size = new Size(colWidthPt, 12);
    const hourText = hourRow.addText(String(itemTime.getHours()));
    hourText.font = Font.semiboldSystemFont(9);
    hourText.textColor = defaultColor();
    hourText.lineLimit = 1;
    hourText.minimumScaleFactor = 0.7;

    // Weather emoji
    const symbolCode = getValue(item, "symbol_code", "Wsymb2");
    const night = isNight(itemTime, lat, lon);
    const emoji = getWeatherEmoji(symbolCode, night);
    const emojiRow = colStack.addStack();
    emojiRow.layoutHorizontally();
    emojiRow.centerAlignContent();
    emojiRow.size = new Size(colWidthPt, 16);
    const emojiText = emojiRow.addText(emoji);
    emojiText.font = Font.systemFont(13);
    emojiText.lineLimit = 1;
    emojiText.minimumScaleFactor = 0.7;

    // Temperature
    const temp = Math.round(getValue(item, "air_temperature", "t"));
    const tempRow = colStack.addStack();
    tempRow.layoutHorizontally();
    tempRow.size = new Size(colWidthPt, 12);
    tempRow.centerAlignContent();
    const tempText = tempRow.addText(`${temp}°`);
    tempText.font = Font.boldSystemFont(9);
    tempText.textColor = defaultColor();
    tempText.lineLimit = 1;
    tempText.minimumScaleFactor = 0.6;

    // Wind strength & direction
    const windSpeed = getValue(item, "wind_speed", "ws");
    const windDirection = getValue(item, "wind_from_direction", "wd");
    const windArrow = getWindArrow(windDirection);
    const windRow = colStack.addStack();
    windRow.layoutHorizontally();
    windRow.size = new Size(colWidthPt, 11);
    windRow.centerAlignContent();
    const windText = windRow.addText(`${windArrow}${Math.round(windSpeed)}`);
    windText.font = Font.systemFont(8);
    windText.textColor = subtitleColor();
    windText.lineLimit = 1;
    windText.minimumScaleFactor = 0.6;
  }

  // Right inset aligns column 15 center over the last dot of the probability curve
  forecastStack.addSpacer(titleRightInset);

  forecastRow.addSpacer();

  widget.addSpacer(2);

  // 5. PRECIPITATION CHART IMAGE (BARS + CURVE)
  const chartStack = widget.addStack();
  chartStack.layoutHorizontally();
  chartStack.setPadding(0, 0, 0, 0);

  chartStack.addSpacer();
  const chartImg = createWeatherChart(
    forecasts,
    CHART_WIDTH,
    CHART_HEIGHT,
    lat,
    lon,
  );
  const chartWidget = chartStack.addImage(chartImg);
  chartWidget.resizable = true;
  chartWidget.applyFittingContentMode();
  // Pin the displayed width to exactly contentWidth — the same value the
  // forecast row above is built against — so both rows share one known,
  // deterministic scale factor instead of relying on implicit auto-fit sizing.
  chartWidget.imageSize = new Size(
    contentWidth,
    contentWidth * (CHART_HEIGHT / CHART_WIDTH),
  );
  chartStack.addSpacer();

  return widget;
}

// ==========================================
// CHART GENERATOR (DrawContext)
// ==========================================
function createWeatherChart(forecasts, width, height, lat, lon) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const leftAxisWidth = CHART_LEFT_AXIS_WIDTH;
  const rightAxisWidth = CHART_RIGHT_AXIS_WIDTH;
  const chartAreaWidth = width - leftAxisWidth - rightAxisWidth;
  const colWidth = chartAreaWidth / forecasts.length;

  const chartTopPad = 12;
  const chartBottomPad = 8;
  const chartHeight = height - chartTopPad - chartBottomPad;

  // Determine maximum precipitation in this window (minimum scale 1.5 mm)
  let maxRain = 1.5;
  for (let i = 0; i < forecasts.length; i++) {
    const pmax = getValue(forecasts[i], "precipitation_amount_max", "pmax");
    if (pmax > maxRain) maxRain = pmax;
  }

  // 1. Draw horizontal grid lines (spanning the chart area only)
  const gridColor = new Color("#8E8E93", 0.25);
  const axisLabelFont = Font.systemFont(25);
  const probAxisColor = new Color("#FF9500", 0.95);
  const precipAxisColor = new Color("#0A78EB", 1.0);

  [0, 0.5, 1].forEach((level) => {
    const y = height - chartBottomPad - level * chartHeight;

    const path = new Path();
    path.move(new Point(leftAxisWidth, y));
    path.addLine(new Point(leftAxisWidth + chartAreaWidth, y));
    ctx.addPath(path);
    ctx.setStrokeColor(gridColor);
    ctx.setLineWidth(1);
    ctx.strokePath();

    // Left axis: probability of precipitation (%)
    drawSideText(
      ctx,
      `${Math.round(level * 100)}%`,
      -20,
      y - 16,
      leftAxisWidth + 20,
      32,
      axisLabelFont,
      probAxisColor,
      "right",
    );

    // Right axis: precipitation rate (mm)
    drawSideText(
      ctx,
      `${(level * maxRain).toFixed(1)}`,
      leftAxisWidth + chartAreaWidth + 6,
      y - 16,
      rightAxisWidth - 6,
      32,
      axisLabelFont,
      precipAxisColor,
      "left",
    );
  });

  const barWidth = Math.floor(colWidth * 0.8);

  // 2. Bottom Layer: Min & Max Precipitation Bars
  for (let i = 0; i < forecasts.length; i++) {
    const item = forecasts[i];
    const pmin = getValue(item, "precipitation_amount_min", "pmin") || 0;
    const pmax = getValue(item, "precipitation_amount_max", "pmax") || 0;

    const centerX = leftAxisWidth + i * colWidth + colWidth / 2;
    const barX = centerX - barWidth / 2;

    // Outer light-blue bar: Maximum precipitation
    if (pmax > 0) {
      const maxBarHeight = Math.max(3, (pmax / maxRain) * chartHeight);
      const maxRect = new Rect(
        barX,
        height - chartBottomPad - maxBarHeight,
        barWidth,
        maxBarHeight,
      );
      ctx.setFillColor(new Color("#64D2FF", 0.45));
      ctx.fillRect(maxRect);
    }

    // Inner solid-blue bar: Minimum precipitation
    if (pmin > 0) {
      const minBarHeight = Math.max(3, (pmin / maxRain) * chartHeight);
      const minRect = new Rect(
        barX,
        height - chartBottomPad - minBarHeight,
        barWidth,
        minBarHeight,
      );
      ctx.setFillColor(new Color("#007AFF", 0.85));
      ctx.fillRect(minRect);
    }
  }

  // 3. Top Layer: Precipitation Probability Curve (%)
  const curvePath = new Path();
  const points = [];

  for (let i = 0; i < forecasts.length; i++) {
    const item = forecasts[i];
    const pop = getValue(item, "probability_of_precipitation", "pop") || 0;
    const centerX = leftAxisWidth + i * colWidth + colWidth / 2;
    const y = height - chartBottomPad - (pop / 100) * chartHeight;
    points.push(new Point(centerX, y));

    if (i === 0) {
      curvePath.move(new Point(centerX, y));
    } else {
      curvePath.addLine(new Point(centerX, y));
    }
  }

  // Stroke the probability line
  ctx.addPath(curvePath);
  ctx.setStrokeColor(new Color("#FF9500", 0.95));
  ctx.setLineWidth(3.0);
  ctx.strokePath();

  // Draw dot markers at each hour point on the curve
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const dotRadius = 4.0;
    const dotRect = new Rect(
      pt.x - dotRadius,
      pt.y - dotRadius,
      dotRadius * 2,
      dotRadius * 2,
    );
    ctx.setFillColor(new Color("#FF9500"));
    ctx.fillEllipse(dotRect);
  }

  return ctx.getImage();
}

// ==========================================
// HELPERS & FORMATTERS
// ==========================================

function drawCenteredText(ctx, text, x, y, w, h, font, color) {
  ctx.setFont(font);
  ctx.setTextColor(color);
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(String(text), new Rect(x, y, w, h));
}

function drawSideText(ctx, text, x, y, w, h, font, color, align) {
  ctx.setFont(font);
  ctx.setTextColor(color);
  if (align === "right") {
    ctx.setTextAlignedRight();
  } else {
    ctx.setTextAlignedLeft();
  }
  ctx.drawTextInRect(String(text), new Rect(x, y, w, h));
}

function getWindArrow(directionFromDeg) {
  const toDeg = (((directionFromDeg + 180) % 360) + 360) % 360;
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const index = Math.round(toDeg / 45) % 8;
  return arrows[index];
}

function defaultColor(forCanvas = false) {
  if (forCanvas) {
    return new Color("#1C1C1E");
  }
  return Color.dynamic(new Color("#1C1C1E"), new Color("#FFFFFF"));
}

function subtitleColor(forCanvas = false) {
  if (forCanvas) {
    return new Color("#6C6C70");
  }
  return Color.dynamic(new Color("#6C6C70"), new Color("#98989D"));
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getValue(item, key1, key2) {
  if (!item) return 0;
  if (item.data) {
    if (item.data[key1] !== undefined) return item.data[key1];
    if (key2 && item.data[key2] !== undefined) return item.data[key2];
  }
  if (Array.isArray(item.parameters)) {
    const p = item.parameters.find((x) => x.name === key1 || x.name === key2);
    if (p && Array.isArray(p.values) && p.values.length > 0) return p.values[0];
  }
  if (item[key1] !== undefined) return item[key1];
  if (key2 && item[key2] !== undefined) return item[key2];
  return 0;
}

function getUpcomingHours(timeSeries, count) {
  const now = new Date();
  const currentHourTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
  ).getTime();

  const futureOrCurrent = timeSeries.filter((item) => {
    const itemTime = new Date(item.time || item.validTime).getTime();
    return itemTime >= currentHourTime;
  });

  return futureOrCurrent.slice(0, count);
}

// ==========================================
// ASTRONOMY & DAY/NIGHT CALCULATOR
// ==========================================

function isNight(date, lat, lon) {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date - startOfYear;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  const declination =
    23.45 *
    Math.sin((360 / 365) * (dayOfYear - 81) * (Math.PI / 180)) *
    (Math.PI / 180);

  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarTime = (utcHours + lon / 15 + 24) % 24;
  const hourAngle = 15 * (solarTime - 12) * (Math.PI / 180);

  const latRad = lat * (Math.PI / 180);
  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(sinElevation) * (180 / Math.PI);

  return elevation < -0.833;
}

function getWeatherEmoji(code, night) {
  if (night) {
    if (code === 1 || code === 2) return "🌙";
    if (code === 3 || code === 4 || code === 5) return "☁️";
    if (code === 8 || code === 9 || code === 10) return "🌧️";
  }

  const map = {
    1: "☀️",
    2: "🌤️",
    3: "⛅",
    4: "⛅",
    5: "🌥️",
    6: "☁️",
    7: "🌫️",
    8: "🌦️",
    9: "🌦️",
    10: "🌦️",
    11: "⛈️",
    12: "🌨️",
    13: "🌨️",
    14: "🌨️",
    15: "🌨️",
    16: "🌨️",
    17: "🌨️",
    18: "🌧️",
    19: "🌧️",
    20: "🌧️",
    21: "🌩️",
    22: "🌨️",
    23: "🌨️",
    24: "🌨️",
    25: "🌨️",
    26: "🌨️",
    27: "🌨️",
  };
  return map[code] || "🌤️";
}
