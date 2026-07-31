// ==========================================
// FALLBACK CONFIGURATION
// (Used if GPS permissions are denied/offline)
// ==========================================
const FALLBACK_NAME = "Lund";
const FALLBACK_LAT = 55.7047;
const FALLBACK_LON = 13.191;

// ==========================================
// SHARED CHART DIMENSIONS
// (Used both to draw the chart image and to compute matching
// left/right insets for the title row, so "Lund" / "Updated ..."
// line up with the chart's own left/right edges.)
// ==========================================
const CHART_WIDTH = 1072;
const CHART_HEIGHT = 340;
const CHART_LEFT_AXIS_WIDTH = 58;
const CHART_RIGHT_AXIS_WIDTH = 68;

// Approximate available content width (in points) of the widget the
// chart is displayed in, after outer padding. This is only used to
// scale the title row's insets proportionally to the chart's axis
// widths — tune this if your widget family/device differs and the
// alignment looks off (larger value = smaller insets, and vice versa).
const ASSUMED_WIDGET_CONTENT_WIDTH = 323;

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

  // 1. Fetch GPS Location & City Name
  let lat = FALLBACK_LAT;
  let lon = FALLBACK_LON;
  let locationName = FALLBACK_NAME;

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
  let data;
  let fetchTimeStr = "";

  try {
    const req = new Request(apiUrl);
    data = await req.loadJSON();
    fetchTimeStr = formatTime(new Date());
  } catch (e) {
    const errText = widget.addText("Failed to load SMHI data");
    errText.textColor = Color.red();
    errText.font = Font.boldSystemFont(12);
    return widget;
  }

  const timeSeries = data?.timeSeries || [];
  if (!Array.isArray(timeSeries) || timeSeries.length === 0) {
    const errText = widget.addText("No forecast data available");
    errText.textColor = Color.orange();
    errText.font = Font.boldSystemFont(12);
    return widget;
  }

  // 3. TITLE ROW
  // Insets are proportional to the chart's own axis-label margins, so
  // "Lund" and "Updated ..." line up with the chart's left/right edges.
  const titleLeftInset = Math.round(
    ASSUMED_WIDGET_CONTENT_WIDTH * (CHART_LEFT_AXIS_WIDTH / CHART_WIDTH),
  );
  const titleRightInset = Math.round(
    ASSUMED_WIDGET_CONTENT_WIDTH * (CHART_RIGHT_AXIS_WIDTH / CHART_WIDTH),
  );

  const titleStack = widget.addStack();
  titleStack.layoutHorizontally();
  titleStack.centerAlignContent();
  titleStack.setPadding(0, 2, 0, 2);

  titleStack.addSpacer(titleLeftInset);

  const titleText = titleStack.addText(locationName);
  titleText.font = Font.boldSystemFont(13);
  titleText.textColor = defaultColor();

  titleStack.addSpacer();

  const timeText = titleStack.addText(`Updated ${fetchTimeStr}`);
  timeText.font = Font.systemFont(10);
  timeText.textColor = subtitleColor();

  titleStack.addSpacer(titleRightInset);

  widget.addSpacer(6);

  // 4. COMBINED TIMELINE + CHART IMAGE
  // Hours, symbols, temps, and the precipitation bars/curve are all drawn
  // onto ONE canvas using the same column-width math, so they line up
  // exactly no matter the widget's rendered size.
  const forecasts = getUpcomingHours(timeSeries, 16);

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
  chartStack.addSpacer();

  return widget;
}

// ==========================================
// CHART GENERATOR (DrawContext)
// Draws: hour row, emoji row, temp row, then precip bars + probability curve
// All columns share the same `colWidth`, so everything aligns vertically.
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

  // --- Text block layout (hour / emoji / temp / wind) ---
  const rowPad = 4;
  const hourRowY = rowPad;
  const hourRowH = 32;
  const emojiRowY = hourRowY + hourRowH;
  const emojiRowH = 58;
  const tempRowY = emojiRowY + emojiRowH;
  const tempRowH = 38;
  const windRowY = tempRowY + tempRowH;
  const windRowH = 34;
  const textBlockBottom = windRowY + windRowH;

  // --- Draw separate permanent white backdrops ---
  // In Light Mode (white widget background), these cards are invisible.
  // In Dark Mode (black widget background), they create clean white
  // rounded bars behind the hour row and the combined temp+wind rows.
  ctx.setFillColor(new Color("#FFFFFF"));

  // 1. White backdrop behind the HOURS row
  const hourBackdropRect = new Rect(
    leftAxisWidth,
    hourRowY - 2,
    chartAreaWidth,
    hourRowH + 4,
  );
  const hourBackdropPath = new Path();
  hourBackdropPath.addRoundedRect(hourBackdropRect, 10, 10);
  ctx.addPath(hourBackdropPath);
  ctx.fillPath();

  // 2. White backdrop behind the combined TEMPERATURE + WIND rows
  const tempWindBackdropRect = new Rect(
    leftAxisWidth,
    tempRowY - 2,
    chartAreaWidth,
    tempRowH + windRowH + 4,
  );
  const tempWindBackdropPath = new Path();
  tempWindBackdropPath.addRoundedRect(tempWindBackdropRect, 12, 12);
  ctx.addPath(tempWindBackdropPath);
  ctx.fillPath();

  for (let i = 0; i < forecasts.length; i++) {
    const item = forecasts[i];
    const colX = leftAxisWidth + i * colWidth;
    const itemTime = new Date(item.time || item.validTime);

    // Hour
    const hourStr = String(itemTime.getHours());
    drawCenteredText(
      ctx,
      hourStr,
      colX,
      hourRowY,
      colWidth,
      hourRowH,
      Font.semiboldSystemFont(25),
      defaultColor(true),
    );

    // Weather emoji (no backdrop behind this row)
    const symbolCode = getValue(item, "symbol_code", "Wsymb2");
    const night = isNight(itemTime, lat, lon);
    const emoji = getWeatherEmoji(symbolCode, night);
    drawCenteredText(
      ctx,
      emoji,
      colX,
      emojiRowY,
      colWidth,
      emojiRowH,
      Font.systemFont(42),
      defaultColor(true),
    );

    // Temperature
    const temp = Math.round(getValue(item, "air_temperature", "t"));
    drawCenteredText(
      ctx,
      `${temp}°`,
      colX,
      tempRowY,
      colWidth,
      tempRowH,
      Font.boldSystemFont(25),
      defaultColor(true),
    );

    // Wind: direction arrow (points where the wind is blowing TO) + speed
    const windSpeed = getValue(item, "wind_speed", "ws");
    const windDirection = getValue(item, "wind_from_direction", "wd");
    const windArrow = getWindArrow(windDirection);
    const windLabel = `${windArrow}${Math.round(windSpeed)}`;
    drawCenteredText(
      ctx,
      windLabel,
      colX,
      windRowY,
      colWidth,
      windRowH,
      Font.systemFont(22),
      subtitleColor(true),
    );
  }

  // --- Chart area layout (below text block) ---
  const chartTopPad = textBlockBottom + 8;
  const chartBottomPad = 8;
  const chartHeight = height - chartTopPad - chartBottomPad;

  // Determine maximum precipitation in this window (minimum scale 1.5 mm)
  let maxRain = 1.5;
  for (let i = 0; i < forecasts.length; i++) {
    const pmax = getValue(forecasts[i], "precipitation_amount_max", "pmax");
    if (pmax > maxRain) maxRain = pmax;
  }

  // 1. Draw horizontal grid lines (spanning the chart area only) with
  //    a left axis for probability (%) and a right axis for precipitation (mm).
  //    Both axes share the same 0 / 0.5 / 1 gridlines, so they line up exactly.
  const gridColor = new Color("#8E8E93", 0.25);
  const axisLabelFont = Font.systemFont(24);
  const probAxisColor = new Color("#FF9500", 0.95);

  // Vibrant medium-cobalt blue with high visibility on both white and black backgrounds
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
      0,
      y - 14,
      leftAxisWidth - 6,
      28,
      axisLabelFont,
      probAxisColor,
      "right",
    );

    // Right axis: precipitation rate (mm)
    drawSideText(
      ctx,
      `${(level * maxRain).toFixed(1)}`,
      leftAxisWidth + chartAreaWidth + 6,
      y - 14,
      rightAxisWidth - 6,
      28,
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
  ctx.setStrokeColor(new Color("#FF9500", 0.95)); // Vibrant warm orange
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
  // SMHI's wind_direction is the direction the wind is blowing FROM.
  // Rotate 180° so the arrow points where the wind is blowing TO,
  // matching the convention used by most weather apps.
  const toDeg = (((directionFromDeg + 180) % 360) + 360) % 360;
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const index = Math.round(toDeg / 45) % 8;
  return arrows[index];
}

function defaultColor(forCanvas = false) {
  if (forCanvas) {
    return new Color("#1C1C1E"); // Always dark for canvas text on white backdrop
  }
  return Color.dynamic(new Color("#1C1C1E"), new Color("#FFFFFF"));
}

function subtitleColor(forCanvas = false) {
  if (forCanvas) {
    return new Color("#6C6C70"); // Always gray for canvas text on white backdrop
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

// SMHI Wsymb2 code to emoji mapping with night adjustments
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
