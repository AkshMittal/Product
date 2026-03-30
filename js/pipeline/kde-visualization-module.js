/**
 * KDE Visualization Module
 * Pure observational visualization of sampling audit data
 * Computes Kernel Density Estimates (KDE) and renders plots using D3
 * 
 * Principles:
 * - Show the data as it is. Do not decide what it means.
 * - No bins, histograms, thresholds, or classifications
 * - No smoothing except explicit KDE calculation
 * - No interpretation of peaks or outliers
 */

/**
 * Computes Kernel Density Estimate using Gaussian kernel in log space
 * 
 * KDE formula: f(x) = (1/nh) * Σ K((x - x_i) / h)
 * where K is the Gaussian kernel: K(u) = (1/√(2π)) * exp(-0.5 * u²)
 * 
 * All computation occurs in log space (ln(x)), but returns both log and linear x values
 * 
 * @param {Array<number>} data - Array of positive, finite values (linear space)
 * @param {number} bandwidth - Bandwidth parameter (h) in log space
 * @param {number} numPoints - Number of evaluation points for KDE curve
 * @returns {Array<{xLog: number, xLinear: number, y: number}>} KDE curve points
 *   - xLog: x position in log space (for rendering)
 *   - xLinear: x position in linear space (for display/tooltips)
 *   - y: density value
 */
function computeKDE(data, bandwidth, numPoints = 200) {
  // Filter to only positive, finite values (as per requirements)
  const validData = data.filter(d => d > 0 && isFinite(d));
  
  if (validData.length === 0) {
    return [];
  }
  
  // Transform data to log space for KDE computation
  const validDataLog = validData.map(d => Math.log(d));
  
  const minLog = Math.min(...validDataLog);
  const maxLog = Math.max(...validDataLog);
  
  // KDE evaluation grid spans exactly [min(log(data)), max(log(data))] - no padding
  const xMinLog = minLog;
  const xMaxLog = maxLog;
  
  const kdePoints = [];
  const n = validDataLog.length;
  const h = bandwidth; // Bandwidth is already in log space
  
  // Pre-compute normalization constant: 1/(n * h * √(2π))
  const normalization = 1 / (n * h * Math.sqrt(2 * Math.PI));
  
  // Evaluate KDE at each point in log space
  for (let i = 0; i < numPoints; i++) {
    const xLog = xMinLog + (xMaxLog - xMinLog) * (i / (numPoints - 1));
    
    // Sum kernel contributions from all data points (in log space)
    let density = 0;
    for (let j = 0; j < n; j++) {
      const u = (xLog - validDataLog[j]) / h;
      // Gaussian kernel: exp(-0.5 * u²)
      density += Math.exp(-0.5 * u * u);
    }
    
    // Apply normalization
    density *= normalization;
    
    // Store both log and linear x values
    const xLinear = Math.exp(xLog);
    kdePoints.push({ xLog: xLog, xLinear: xLinear, y: density });
  }
  
  return kdePoints;
}

/**
 * Detects local maxima (peaks) in KDE curve
 * A peak is a point where y[i] > y[i-1] && y[i] > y[i+1]
 * 
 * @param {Array<{xLog: number, xLinear: number, y: number}>} kdePoints - KDE curve points (in log space)
 * @returns {Array<{xLog: number, xLinear: number, y: number}>} Peak locations
 */
function detectPeaks(kdePoints) {
  if (kdePoints.length < 3) {
    return [];
  }
  
  const peaks = [];
  
  // Check interior points (skip first and last)
  for (let i = 1; i < kdePoints.length - 1; i++) {
    const prev = kdePoints[i - 1];
    const curr = kdePoints[i];
    const next = kdePoints[i + 1];
    
    // Local maximum: current y is greater than both neighbors
    if (curr.y > prev.y && curr.y > next.y) {
      peaks.push({ xLog: curr.xLog, xLinear: curr.xLinear, y: curr.y });
    }
  }
  
  return peaks;
}

/**
 * Renders KDE plot with D3 using log-space x-axis
 * 
 * All geometry (KDE curve, rug ticks, peaks) uses log-space positions
 * Display values (tooltips, axis labels) show linear-space values
 * 
 * @param {string} containerId - ID of container element
 * @param {Array<{xLog: number, xLinear: number, y: number}>} kdePoints - KDE curve points (in log space)
 * @param {Array<{xLog: number, xLinear: number, y: number}>} peaks - Peak locations (in log space)
 * @param {Array<number>} rawData - Raw data array in linear space for rug plot overlay
 * @param {string} xLabel - X-axis label (will be modified to indicate log scale)
 * @param {string} title - Plot title
 */
function renderKDEPlot(containerId, kdePoints, peaks, rawData, xLabel, title) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();
  
  if (kdePoints.length === 0) {
    container.append("p").text("No data to visualize");
    return;
  }
  
  // Transform raw data to log space for positioning
  const rawDataLog = rawData ? rawData.filter(d => d > 0 && isFinite(d)).map(d => Math.log(d)) : [];
  
  const margin = { top: 40, right: 30, bottom: 60, left: 80 };
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;
  
  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  
  // Add clipPath to prevent overflow
  const clipPath = svg.append("defs").append("clipPath")
    .attr("id", `clip-${containerId}`)
    .append("rect")
    .attr("width", width)
    .attr("height", height);
  
  // Domain derived from KDE points in log space; lower bound includes zero so low values are not clipped
  const safeLogZero = Math.log(1e-10);
  const xMinLog = Math.min(safeLogZero, d3.min(kdePoints, d => d.xLog));
  const xMaxLog = d3.max(kdePoints, d => d.xLog);
  const xDomainOriginal = [xMinLog, xMaxLog];
  const yDomainOriginal = [0, d3.max(kdePoints, d => d.y)];
  
  // X-scale uses log-space domain (for positioning)
  const xScaleOriginal = d3.scaleLinear()
    .domain(xDomainOriginal)
    .nice()
    .range([0, width]);
  
  const yScaleOriginal = d3.scaleLinear()
    .domain(yDomainOriginal)
    .nice()
    .range([height, 0]);
  
  // Working scales (will be updated on zoom)
  const xScale = xScaleOriginal.copy();
  const yScale = yScaleOriginal.copy();
  
  // Line generator for KDE curve (uses xLog for positioning)
  const line = d3.line()
    .x(d => xScale(d.xLog))
    .y(d => yScale(d.y))
    .curve(d3.curveMonotoneX);
  
  // Create groups for different elements with clipping
  const plotGroup = g.append("g")
    .attr("clip-path", `url(#clip-${containerId})`);
  
  // Rug plot group (drawn first, behind KDE curve)
  const rugGroup = plotGroup.append("g").attr("class", "rug-plot");
  
  const kdePath = plotGroup.append("path")
    .datum(kdePoints)
    .attr("fill", "none")
    .attr("stroke", "steelblue")
    .attr("stroke-width", 2);
  
  const peaksGroup = plotGroup.append("g").attr("class", "peaks");
  
  const xAxis = g.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`);
  
  const yAxis = g.append("g")
    .attr("class", "y-axis");
  
  // Function to redraw elements
  const redraw = () => {
    // Apply nice() to scales for better axis tick marks
    xScale.nice();
    yScale.nice();
    
    // Update rug plot - simple rug dashes, one tick per observation
    // Normal rug plot style with slightly elongated ticks, no stacking or collision handling
    if (rawDataLog && rawDataLog.length > 0) {
      const rugTicks = rugGroup.selectAll("line.rug-tick")
        .data(rawDataLog, (d, i) => i); // Use index as key to ensure one tick per data point
      
      rugTicks.enter()
        .append("line")
        .attr("class", "rug-tick")
        .merge(rugTicks)
        .attr("x1", d => xScale(d))
        .attr("x2", d => xScale(d))
        .attr("y1", height)
        .attr("y2", height - 16) // Slightly elongated ticks (16px height)
        .attr("stroke", "#333")
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.6);
      
      rugTicks.exit().remove();
    }
    
    // Update KDE curve
    kdePath.attr("d", line);
    
    // Update peaks (use xLog for positioning)
    peaksGroup.selectAll("*").remove();
    peaks.forEach(peak => {
      // Only draw peaks that are within the current domain (log space)
      if (peak.xLog >= xScale.domain()[0] && peak.xLog <= xScale.domain()[1] &&
          peak.y >= yScale.domain()[0] && peak.y <= yScale.domain()[1]) {
        peaksGroup.append("line")
          .attr("x1", xScale(peak.xLog))
          .attr("x2", xScale(peak.xLog))
          .attr("y1", yScale(peak.y))
          .attr("y2", height)
          .attr("stroke", "red")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "3,3")
          .attr("opacity", 0.6);
        
        peaksGroup.append("circle")
          .attr("cx", xScale(peak.xLog))
          .attr("cy", yScale(peak.y))
          .attr("r", 4)
          .attr("fill", "red");
      }
    });
    
    // Update axes - x-axis shows linear values but uses log-space scale
    // Create custom tick formatter to display linear values
    const xAxisFormatter = d3.axisBottom(xScale)
      .tickSizeOuter(0)
      .tickFormat(d => {
        const linearValue = Math.exp(d);
        return Math.abs(linearValue) >= 1 ? String(Math.round(linearValue)) : linearValue.toFixed(2);
      });
    xAxis.call(xAxisFormatter);
    yAxis.call(d3.axisLeft(yScale).tickSizeOuter(0));
  };
  
  // Initial draw
  redraw();
  
  // X-axis label - display linear units (computation is in log space, but display is linear)
  xAxis.append("text")
    .attr("x", width / 2)
    .attr("y", 45)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text(xLabel);
  
  // Y-axis label
  yAxis.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", -50)
    .attr("x", -height / 2)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text("Density");
  
  // Title
  svg.append("text")
    .attr("x", (width + margin.left + margin.right) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text(title);
  
  // Tooltip for hover
  const tooltip = container.append("div")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "rgba(0, 0, 0, 0.8)")
    .style("color", "white")
    .style("padding", "5px")
    .style("border-radius", "3px")
    .style("pointer-events", "none");
  
  // Pan behavior only (no zoom)
  const zoom = d3.zoom()
    .scaleExtent([1, 1]) // Disable zoom, only allow panning
    .extent([[0, 0], [width, height]])
    .on("zoom", function(event) {
      // Update scales based on pan transform (translation only, no scaling)
      const transform = event.transform;
      let newXDomain = transform.rescaleX(xScaleOriginal).domain();
      let newYDomain = transform.rescaleY(yScaleOriginal).domain();
      
      // Constrain domains to original KDE domain only (no clamping to zero)
      // X-axis: clamp to original KDE domain
      newXDomain[0] = Math.max(xDomainOriginal[0], Math.min(newXDomain[0], xDomainOriginal[1]));
      newXDomain[1] = Math.max(newXDomain[0], Math.min(newXDomain[1], xDomainOriginal[1]));
      
      // Y-axis: clamp to original KDE domain
      newYDomain[0] = Math.max(yDomainOriginal[0], Math.min(newYDomain[0], yDomainOriginal[1]));
      newYDomain[1] = Math.max(newYDomain[0], Math.min(newYDomain[1], yDomainOriginal[1]));
      
      // Update scales with constrained domains
      xScale.domain(newXDomain);
      yScale.domain(newYDomain);
      
      // Redraw all elements (nice() will be applied in redraw)
      redraw();
    });
  
  // Add pan to the main group
  g.call(zoom);
  
  // Store zoom reference for reset functionality
  window[`${containerId}_zoom`] = zoom;
  window[`${containerId}_g`] = g;
  
  // Add hover interaction (on top of pan)
  // Hover detection: screen → log space → linear space for display
  g.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "grab")
    .on("mousemove", function(event) {
      const [mouseX] = d3.pointer(event);
      const xValueLog = xScale.invert(mouseX); // Get value in log space
      
      // Find closest KDE point (compare in log space)
      let closest = kdePoints[0];
      let minDist = Math.abs(kdePoints[0].xLog - xValueLog);
      for (let i = 1; i < kdePoints.length; i++) {
        const dist = Math.abs(kdePoints[i].xLog - xValueLog);
        if (dist < minDist) {
          minDist = dist;
          closest = kdePoints[i];
        }
      }
      
      // Display linear-space value in tooltip
      tooltip
        .style("visibility", "visible")
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 10) + "px")
        .html(`x: ${closest.xLinear.toFixed(4)}<br/>y: ${closest.y.toFixed(6)}`);
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
    });
}

/**
 * Renders an empty chart with axes and a message (e.g. when valid timestamps not present).
 * @param {string} containerId - ID of container element
 * @param {string} chartType - "time-kde" | "distance-kde" | "scatter" for axis labels
 * @param {string} message - Text to display
 */
function renderEmptyChartWithMessage(containerId, chartType, message) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();

  const margin = { top: 40, right: 30, bottom: 60, left: 80 };
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  if (chartType === "time-kde") {
    const xScale = d3.scaleLinear().domain([0.1, 100]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).tickFormat(d => d.toFixed(1)))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("g")
      .call(d3.axisLeft(yScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Time Delta (seconds, log-scaled)");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -height / 2)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Density");
  } else if (chartType === "distance-kde") {
    const xScale = d3.scaleLinear().domain([0.1, 1000]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).tickFormat(d => d.toFixed(1)))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("g")
      .call(d3.axisLeft(yScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Distance Delta (meters, log-scaled)");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -height / 2)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Density");
  } else if (chartType === "index-time-delta") {
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([height, 0]);
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("g")
      .call(d3.axisLeft(yScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Index");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -height / 2)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Time delta (seconds, log-scaled)");
  } else {
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([height, 0]);
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("g")
      .call(d3.axisLeft(yScale))
      .attr("stroke", "#ffffff")
      .attr("color", "#ffffff");
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Time Delta (seconds, log-scaled)");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -height / 2)
      .attr("fill", "#ffffff")
      .style("text-anchor", "middle")
      .text("Distance Delta (meters, log-scaled)");
  }

  g.append("text")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .attr("fill", "#ffffff")
    .style("text-anchor", "middle")
    .style("font-size", "14px")
    .text(message);
}

/**
 * Renders scatterplot of joint time-distance pairs
 * 
 * @param {string} containerId - ID of container element
 * @param {Array<{dtSec: number, ddMeters: number}>} pairs - Time-distance pairs
 */
function renderScatterPlot(containerId, pairs) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();
  
  if (pairs.length === 0) {
    container.append("p").text("No data to visualize");
    return;
  }
  
  const margin = { top: 40, right: 30, bottom: 60, left: 80 };
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;
  
  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);
  
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  
  // Inner group for zoom so g keeps margin (reset won't lose margin)
  const zoomG = g.append("g");
  
  // Add clipPath to prevent overflow
  const clipPath = svg.append("defs").append("clipPath")
    .attr("id", `clip-${containerId}`)
    .append("rect")
    .attr("width", width)
    .attr("height", height);
  
  // Domains in log space; lower bound includes zero so low values are not clipped
  const safeLog = (v) => Math.log(Math.max(1e-10, v));
  const safeLogZero = Math.log(1e-10);
  const xLogExtent = d3.extent(pairs, d => safeLog(d.dtSec));
  const yLogExtent = d3.extent(pairs, d => safeLog(d.ddMeters));
  const xDomainOriginal = [Math.min(safeLogZero, xLogExtent[0]), xLogExtent[1]];
  const yDomainOriginal = [Math.min(safeLogZero, yLogExtent[0]), yLogExtent[1]];
  
  const xScaleOriginal = d3.scaleLinear()
    .domain(xDomainOriginal)
    .nice()
    .range([0, width]);
  
  const yScaleOriginal = d3.scaleLinear()
    .domain(yDomainOriginal)
    .nice()
    .range([height, 0]);
  
  // Working scales (will be updated on zoom); domain is log space
  const xScale = xScaleOriginal.copy();
  const yScale = yScaleOriginal.copy();
  
  // Create groups for different elements with clipping (under zoomG)
  const plotGroup = zoomG.append("g")
    .attr("clip-path", `url(#clip-${containerId})`);
  
  const pointsGroup = plotGroup.append("g").attr("class", "points");
  
  const xAxis = zoomG.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`);
  
  const yAxis = zoomG.append("g")
    .attr("class", "y-axis");
  
  // Function to redraw elements (do not call nice() here; domain is set by zoom or initial scale)
  const redraw = () => {
    // Update points - filter by current domain (log space)
    const visiblePairs = pairs.filter(d => {
      const xLog = safeLog(d.dtSec);
      const yLog = safeLog(d.ddMeters);
      return xLog >= xScale.domain()[0] && xLog <= xScale.domain()[1] &&
             yLog >= yScale.domain()[0] && yLog <= yScale.domain()[1];
    });
    
    const circles = pointsGroup.selectAll("circle")
      .data(visiblePairs);
    
    circles.enter()
      .append("circle")
      .attr("r", 2)
      .attr("fill", "steelblue")
      .attr("opacity", 0.6)
      .merge(circles)
      .attr("cx", d => xScale(safeLog(d.dtSec)))
      .attr("cy", d => yScale(safeLog(d.ddMeters)))
      .on("mouseover", function(event, d) {
        tooltip
          .style("visibility", "visible")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 10) + "px")
          .html(`fromIndex: ${d.fromIndex}<br/>toIndex: ${d.toIndex}<br/>Δt: ${d.dtSec.toFixed(4)}s<br/>Δd: ${d.ddMeters.toFixed(2)}m`);
      })
      .on("mouseout", () => {
        tooltip.style("visibility", "hidden");
      });
    
    circles.exit().remove();
    
    // Update axes: scale emits log-space values; convert to linear for display (same as KDE)
    const tickCount = 6;
    const fmtLinear = (v) => Math.abs(v) >= 1 ? String(Math.round(v)) : v.toFixed(2);
    const xAxisBottom = d3.axisBottom(xScale)
      .ticks(tickCount)
      .tickSizeOuter(0)
      .tickFormat(d => fmtLinear(Math.exp(d)));
    const yAxisLeft = d3.axisLeft(yScale)
      .ticks(tickCount)
      .tickSizeOuter(0)
      .tickFormat(d => fmtLinear(Math.exp(d)));
    xAxis.call(xAxisBottom);
    yAxis.call(yAxisLeft);
  };
  
  // Initial draw
  redraw();
  
  // X-axis label: log-scaled space, linear values (seconds)
  xAxis.append("text")
    .attr("x", width / 2)
    .attr("y", 45)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text("Time delta (seconds, log-scaled)");
  
  // Y-axis label: log-scaled space, linear values (meters)
  yAxis.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", -50)
    .attr("x", -height / 2)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text("Distance delta (meters, log-scaled)");
  
  // Title
  svg.append("text")
    .attr("x", (width + margin.left + margin.right) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("Time-Distance Scatterplot");
  
  // Tooltip for hover
  const tooltip = container.append("div")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "rgba(0, 0, 0, 0.8)")
    .style("color", "white")
    .style("padding", "5px")
    .style("border-radius", "3px")
    .style("pointer-events", "none");
  
  // Pan behavior only (no zoom); pan-by-rescale only (reset zoomG transform so no double-apply)
  const zoom = d3.zoom()
    .scaleExtent([1, 1]) // Disable zoom, only allow panning
    .extent([[0, 0], [width, height]])
    .on("zoom", function(event) {
      const transform = event.transform;
      let newXDomain = transform.rescaleX(xScaleOriginal).domain();
      let newYDomain = transform.rescaleY(yScaleOriginal).domain();
      
      // Constrain domains to original domain only
      newXDomain[0] = Math.max(xDomainOriginal[0], Math.min(newXDomain[0], xDomainOriginal[1]));
      newXDomain[1] = Math.max(newXDomain[0], Math.min(newXDomain[1], xDomainOriginal[1]));
      newYDomain[0] = Math.max(yDomainOriginal[0], Math.min(newYDomain[0], yDomainOriginal[1]));
      newYDomain[1] = Math.max(newYDomain[0], Math.min(newYDomain[1], yDomainOriginal[1]));
      
      // Avoid degenerate domain (would collapse all points to one line)
      const minSpan = 1e-10;
      if (newXDomain[1] - newXDomain[0] < minSpan || newYDomain[1] - newYDomain[0] < minSpan) {
        zoomG.attr("transform", null);
        return;
      }
      
      xScale.domain(newXDomain);
      yScale.domain(newYDomain);
      redraw();
      
      // Pan by rescale only: undo transform on zoomG so only scale drives position
      zoomG.attr("transform", null);
    });
  
  // Add transparent rect for panning (behind points)
  zoomG.insert("rect", ":first-child")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "grab");
  
  zoomG.call(zoom);
  
  // Store zoom and zoomG for reset (zoomG keeps margin on g)
  window[`${containerId}_zoom`] = zoom;
  window[`${containerId}_g`] = zoomG;
}

/**
 * Sequence-aware scatter: X = toIndex (event order), Y = log(dtSec), color = log(ddMeters).
 * Window = horizontal "microscope": only a segment of the sequence is shown, stretched across the chart width.
 * Scrollbar pans the window; x-axis numbering updates to the current window's toIndex range.
 *
 * @param {string} containerId - ID of container element
 * @param {Array<{fromIndex: number, toIndex: number, dtSec: number, ddMeters: number}>} pairs - Joint audit stream
 */
function renderIndexTimeDeltaScatter(containerId, pairs) {
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove();

  if (!pairs || pairs.length === 0) {
    container.append("p").text("No data to visualize");
    return;
  }

  const margin = { top: 40, right: 110, bottom: 100, left: 80 };
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const MAX_WINDOW_SIZE = 200;
  const MIN_WINDOW_SIZE = 30;
  const SMALL_DATA_WINDOW_RATIO = 0.7;
  const pairCount = pairs.length;
  const adaptiveWindow = Math.round(pairCount * SMALL_DATA_WINDOW_RATIO);
  const windowSize = pairCount > MAX_WINDOW_SIZE
    ? MAX_WINDOW_SIZE
    : Math.min(pairCount, Math.max(MIN_WINDOW_SIZE, adaptiveWindow));
  const maxStart = Math.max(0, pairCount - windowSize);

  const svg = container.append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const clipPath = svg.append("defs").append("clipPath")
    .attr("id", `clip-${containerId}`)
    .append("rect")
    .attr("width", width)
    .attr("height", height);

  const safeLog = (v) => Math.log(Math.max(1e-10, v));
  const safeLogZero = Math.log(1e-10);

  const yLogExtent = d3.extent(pairs, d => safeLog(d.dtSec));
  const yLogMin = Math.min(safeLogZero, yLogExtent[0]);
  const yLogMax = yLogExtent[1];
  const ddMetersMin = Math.min(...pairs.map(d => d.ddMeters));
  const ddMetersMax = Math.max(...pairs.map(d => d.ddMeters));
  const maxDd = ddMetersMax;

  // Log1p-based color transfer: ddMeters === 0 maps to 0, no epsilon; small distances get more range. Perceptual only.
  const colorT = (d) => {
    const dd = d.ddMeters;
    if (!isFinite(dd) || dd < 0) return 0;
    if (maxDd === 0) return 0;
    const t = Math.log1p(dd) / Math.log1p(maxDd);
    return Math.min(1, Math.max(0, t));
  };
  const colorTFromDd = (dd) => {
    if (!isFinite(dd) || dd < 0) return 0;
    if (maxDd === 0) return 0;
    const t = Math.log1p(dd) / Math.log1p(maxDd);
    return Math.min(1, Math.max(0, t));
  };

  // Y and color: stable (full data). Y domain includes zero so low values are not clipped. X: set per window (microscope).
  const xScale = d3.scaleLinear().range([0, width]);
  const yScaleOriginal = d3.scaleLinear()
    .domain([yLogMin, yLogMax])
    .range([height, 0]);
  const yScale = yScaleOriginal.copy();
  const yDomainOriginal = [yLogMin, yLogMax];
  const colorScale = d3.scaleSequential(d3.interpolateViridis)
    .domain([0, 1]);

  const zoomG = g.append("g");
  const plotGroup = zoomG.append("g").attr("clip-path", `url(#clip-${containerId})`);
  const pointsGroup = plotGroup.append("g").attr("class", "points");

  const xAxis = zoomG.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`);
  const yAxis = zoomG.append("g").attr("class", "y-axis");

  const tooltip = container.append("div")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background", "rgba(0, 0, 0, 0.8)")
    .style("color", "white")
    .style("padding", "5px")
    .style("border-radius", "3px")
    .style("pointer-events", "none");

  let currentWindowStart = 0;

  function redraw(windowStart) {
    const start = Math.max(0, Math.min(windowStart, maxStart));
    const visibleData = pairs.slice(start, start + windowSize);
    if (visibleData.length === 0) return;

    let xMin = visibleData[0].toIndex;
    let xMax = visibleData[visibleData.length - 1].toIndex;
    if (xMin === xMax) {
      xMin -= 0.5;
      xMax += 0.5;
    }
    xScale.domain([xMin, xMax]);

    const circles = pointsGroup.selectAll("circle")
      .data(visibleData);

    circles.enter()
      .append("circle")
      .attr("class", "sequence-scatter-point")
      .attr("r", 3)
      .attr("opacity", 0.85)
      .attr("stroke", "none")
      .merge(circles)
      .attr("cx", d => xScale(d.toIndex))
      .attr("cy", d => yScale(safeLog(d.dtSec)))
      .attr("fill", d => colorScale(colorT(d)))
      .on("mouseover", function(event, d) {
        tooltip
          .style("visibility", "visible")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 10) + "px")
          .html(`fromIndex: ${d.fromIndex}<br/>toIndex: ${d.toIndex}<br/>dtSec: ${d.dtSec.toFixed(4)}<br/>ddMeters: ${d.ddMeters.toFixed(2)}`);
      })
      .on("mouseout", () => tooltip.style("visibility", "hidden"));

    circles.exit().remove();

    xAxis.call(d3.axisBottom(xScale).ticks(8).tickSizeOuter(0));
    yAxis.call(d3.axisLeft(yScale)
      .ticks(6)
      .tickSizeOuter(0)
      .tickFormat(d => {
        const v = Math.exp(d);
        return Math.abs(v) >= 1 ? String(Math.round(v)) : v.toFixed(2);
      }));
  }

  redraw(0);

  // Pan only (no zoom), same as other delta charts; Y-axis pannable
  const zoom = d3.zoom()
    .scaleExtent([1, 1])
    .extent([[0, 0], [width, height]])
    .on("zoom", function(event) {
      const transform = event.transform;
      let newYDomain = transform.rescaleY(yScaleOriginal).domain();
      newYDomain[0] = Math.max(yDomainOriginal[0], Math.min(newYDomain[0], yDomainOriginal[1]));
      newYDomain[1] = Math.max(newYDomain[0], Math.min(newYDomain[1], yDomainOriginal[1]));
      const minSpan = 1e-10;
      if (newYDomain[1] - newYDomain[0] < minSpan) {
        zoomG.attr("transform", null);
        return;
      }
      yScale.domain(newYDomain);
      redraw(currentWindowStart);
      zoomG.attr("transform", null);
    });

  zoomG.insert("rect", ":first-child")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "grab");

  zoomG.call(zoom);

  xAxis.append("text")
    .attr("x", width / 2)
    .attr("y", 45)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text("toIndex (gpxIndex)");

  yAxis.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", -50)
    .attr("x", -height / 2)
    .attr("fill", "black")
    .style("text-anchor", "middle")
    .text("time delta (seconds, log-scaled)");

  svg.append("text")
    .attr("x", (width + margin.left + margin.right) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("Sequence-aware scatter (windowed)");

  // Vertical color legend: log-spaced anchors in data space, same log1p transfer as points
  const legendBarWidth = 14;
  const legendBarHeight = height;
  const legendX = margin.left + width + 12;
  const legendY = margin.top;

  const legendGradient = svg.append("defs").append("linearGradient")
    .attr("id", `legend-gradient-${containerId}`)
    .attr("x1", "0%")
    .attr("x2", "0%")
    .attr("y1", "100%")
    .attr("y2", "0%");

  const nStops = 64;
  for (let i = 0; i <= nStops; i++) {
    const t = i / nStops;
    legendGradient.append("stop")
      .attr("offset", t)
      .attr("stop-color", colorScale(t));
  }

  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendBarWidth)
    .attr("height", legendBarHeight)
    .attr("fill", `url(#legend-gradient-${containerId})`)
    .attr("stroke", "#999");

  const formatDd = (v) => {
    if (v === 0) return "0";
    if (Math.abs(v) >= 1) return String(Math.round(v));
    return v.toFixed(2);
  };
  const formatDdApprox = (v) => v === 0 ? "0" : "~" + (Math.abs(v) >= 1 ? String(Math.round(v)) : v.toFixed(2));

  const log1pMax = Math.log1p(maxDd);
  const anchorValue = (frac) => (log1pMax <= 0 || frac <= 0) ? 0 : Math.exp(frac * log1pMax) - 1;
  const anchors = maxDd <= 0
    ? [0]
    : [
        0,
        anchorValue(0.25),
        anchorValue(0.5),
        anchorValue(0.75),
        maxDd
      ];

  const anchorLabels = maxDd <= 0
    ? ["0 m"]
    : [
        "0 m",
        formatDdApprox(anchorValue(0.25)) + " m",
        formatDdApprox(anchorValue(0.5)) + " m",
        formatDdApprox(anchorValue(0.75)) + " m",
        formatDd(maxDd) + " m"
      ];

  const legendGroup = svg.append("g").attr("class", "color-legend");
  legendGroup.append("text")
    .attr("x", legendX + legendBarWidth / 2)
    .attr("y", legendY - 8)
    .attr("text-anchor", "middle")
    .attr("font-size", "10px")
    .attr("fill", "#555")
    .text("distance delta (log-scaled color)");

  anchors.forEach((val, i) => {
    const t = colorTFromDd(val);
    const y = legendY + (1 - t) * legendBarHeight;
    legendGroup.append("line")
      .attr("x1", legendX)
      .attr("x2", legendX + legendBarWidth)
      .attr("y1", y)
      .attr("y2", y)
      .attr("stroke", "#333")
      .attr("stroke-width", 1);
    legendGroup.append("text")
      .attr("x", legendX + legendBarWidth + 4)
      .attr("y", y)
      .attr("dy", "0.35em")
      .attr("font-size", "9px")
      .attr("fill", "#333")
      .text(anchorLabels[i]);
  });

  const formatWindowRange = (start) => {
    const clampedStart = Math.max(0, Math.min(start, maxStart));
    const end = Math.min(pairCount, clampedStart + windowSize);
    return `${clampedStart} – ${end}`;
  };

  const controlDiv = container.append("div")
    .style("margin-top", "8px")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "8px");

  controlDiv.append("label")
    .attr("for", `${containerId}-window-slider`)
    .text("Pan window (event index): ");

  const slider = controlDiv.append("input")
    .attr("id", `${containerId}-window-slider`)
    .attr("type", "range")
    .attr("min", 0)
    .attr("max", maxStart)
    .attr("value", 0)
    .attr("step", 1)
    .property("disabled", maxStart === 0)
    .style("flex", "1");

  const labelSpan = controlDiv.append("span")
    .style("min-width", "100px")
    .text(formatWindowRange(0));

  slider.on("input", function() {
    const val = +this.value;
    currentWindowStart = val;
    labelSpan.text(formatWindowRange(val));
    redraw(val);
  });

  window[`${containerId}_reset`] = function() {
    yScale.domain([yLogMin, yLogMax]);
    currentWindowStart = 0;
    redraw(0);
    slider.property("value", 0);
    labelSpan.text(formatWindowRange(0));
    zoomG.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  };

  window[`${containerId}_zoom`] = zoom;
  window[`${containerId}_g`] = zoomG;
}

/**
 * Main function to visualize sampling audit data
 * 
 * @param {Object} samplingData - Object containing:
 *   - timeDeltasMs: Array<{fromIndex, toIndex, dtSec}> - Time delta records (referential)
 *   - distanceDeltasM: Array<{fromIndex, toIndex, ddMeters}> - Distance delta records (referential)
 *   - timeDistancePairs: Array<{fromIndex, toIndex, dtSec, ddMeters}> - Joint pairs
 * @param {Object} options - Visualization options
 *   - timeBandwidth: number - Bandwidth for time delta KDE (default: adaptive)
 *   - distanceBandwidth: number - Bandwidth for distance delta KDE (default: adaptive)
 */
function visualizeSamplingData(samplingData, options = {}) {
  const { timeDeltasMs, distanceDeltasM, timeDistancePairs } = samplingData;
  const timeDeltasMsSafe = timeDeltasMs || [];
  const pairs = timeDistancePairs || [];

  // Extract numeric values for KDE (time deltas: { fromIndex, toIndex, dtSec }; distance: { fromIndex, toIndex, ddMeters })
  const timeDeltasSec = timeDeltasMsSafe.map(d => d.dtSec);
  const distanceDeltasMValues = (distanceDeltasM || []).map(d => (typeof d === 'number' ? d : d.ddMeters));

  // Transform data to log space for bandwidth computation
  const timeDeltasSecLog = timeDeltasSec.filter(d => d > 0 && isFinite(d)).map(d => Math.log(d));
  const distanceDeltasMLog = distanceDeltasMValues.filter(d => d > 0 && isFinite(d)).map(d => Math.log(d));

  const hasValidTimeData = timeDeltasSecLog.length > 0;
  const hasValidDistanceData = distanceDeltasMLog.length > 0;

  let timeKDE = [];
  let timePeaks = [];
  let timeBandwidthLog = null;
  let distanceKDE = [];
  let distancePeaks = [];
  let distanceBandwidthLog = null;

  // If no valid timestamps, render empty charts with message for time KDE and scatter
  if (!hasValidTimeData) {
    renderEmptyChartWithMessage("time-kde-plot", "time-kde", "valid timestamps not found in gpx");
    renderEmptyChartWithMessage("time-distance-scatter", "scatter", "valid timestamps not found in gpx");
    renderEmptyChartWithMessage("index-time-delta-scatter", "index-time-delta", "valid timestamps not found in gpx");
    window.kdeTimeDeltasSec = null;
    window.kdeTimeBandwidthLog = null;
  }

  // If no distance deltas, render empty chart with message for distance KDE
  if (!hasValidDistanceData) {
    renderEmptyChartWithMessage("distance-kde-plot", "distance-kde", "no distance deltas in gpx");
    window.kdeDistanceDeltasM = null;
    window.kdeDistanceBandwidthLog = null;
  } else {
    // Determine bandwidths in log space (distance only when distance data exists)
    const distanceStdDevLog = d3.deviation(distanceDeltasMLog) || 1;
    const distanceN = distanceDeltasMLog.length;
    distanceBandwidthLog = options.distanceBandwidth ? Math.log(options.distanceBandwidth) : (1.06 * distanceStdDevLog * Math.pow(distanceN, -0.2));

    distanceKDE = computeKDE(distanceDeltasMValues, distanceBandwidthLog);
    distancePeaks = detectPeaks(distanceKDE);
    window.kdeDistanceDeltasM = distanceDeltasMValues;
    window.kdeDistanceBandwidthLog = distanceBandwidthLog;
    renderKDEPlot("distance-kde-plot", distanceKDE, distancePeaks, distanceDeltasMValues, "Distance Delta (meters)", "Distance Delta KDE");
  }

  // Time KDE and scatter only when valid time data present
  if (hasValidTimeData) {
    const timeStdDevLog = d3.deviation(timeDeltasSecLog) || 1;
    const timeN = timeDeltasSecLog.length;
    timeBandwidthLog = options.timeBandwidth ? Math.log(options.timeBandwidth) : (1.06 * timeStdDevLog * Math.pow(timeN, -0.2));
    timeKDE = computeKDE(timeDeltasSec, timeBandwidthLog);
    timePeaks = detectPeaks(timeKDE);
    window.kdeTimeDeltasSec = timeDeltasSec;
    window.kdeTimeBandwidthLog = timeBandwidthLog;
    renderKDEPlot("time-kde-plot", timeKDE, timePeaks, timeDeltasSec, "Time Delta (seconds)", "Time Delta KDE");
    renderScatterPlot("time-distance-scatter", pairs);
    renderIndexTimeDeltaScatter("index-time-delta-scatter", pairs);
  }
  
  // Initialize bandwidth sliders operating natively in log-space
  // Slider value, min, max are in log-space; display shows exp(bandwidthLog)
  
  // Compute log-space bounds for time bandwidth slider
  if (timeDeltasSecLog.length > 0 && document.getElementById('time-bandwidth-slider')) {
    const timeLogMin = Math.min(...timeDeltasSecLog);
    const timeLogMax = Math.max(...timeDeltasSecLog);
    const timeLogRange = timeLogMax - timeLogMin;
    
    // Define reasonable bounds in log-space
    let hMinLog = Math.max(1e-3, timeLogRange / 50); // Prevents spiky instability
    let hMaxLog = timeLogRange / 5; // Prevents oversmoothing
    
    // Ensure Silverman bandwidth is within bounds (expand if needed)
    if (timeBandwidthLog < hMinLog) {
      hMinLog = Math.max(1e-3, timeBandwidthLog * 0.5);
    }
    if (timeBandwidthLog > hMaxLog) {
      hMaxLog = timeBandwidthLog * 2;
    }
    
    const timeSlider = document.getElementById('time-bandwidth-slider');
    timeSlider.min = hMinLog.toFixed(6);
    timeSlider.max = hMaxLog.toFixed(6);
    timeSlider.step = Math.max(1e-4, (hMaxLog - hMinLog) / 1000).toFixed(6);
    timeSlider.value = timeBandwidthLog; // Slider value is in log-space
    
    // Display linear equivalent for user
    const timeBandwidthLinear = Math.exp(timeBandwidthLog);
    document.getElementById('time-bandwidth-value').textContent = timeBandwidthLinear.toFixed(4);
  }
  
  // Compute log-space bounds for distance bandwidth slider
  if (distanceDeltasMLog.length > 0 && document.getElementById('distance-bandwidth-slider')) {
    const distanceLogMin = Math.min(...distanceDeltasMLog);
    const distanceLogMax = Math.max(...distanceDeltasMLog);
    const distanceLogRange = distanceLogMax - distanceLogMin;
    
    // Define reasonable bounds in log-space
    let hMinLog = Math.max(1e-3, distanceLogRange / 50); // Prevents spiky instability
    let hMaxLog = distanceLogRange / 5; // Prevents oversmoothing
    
    // Ensure Silverman bandwidth is within bounds (expand if needed)
    if (distanceBandwidthLog < hMinLog) {
      hMinLog = Math.max(1e-3, distanceBandwidthLog * 0.5);
    }
    if (distanceBandwidthLog > hMaxLog) {
      hMaxLog = distanceBandwidthLog * 2;
    }
    
    const distanceSlider = document.getElementById('distance-bandwidth-slider');
    distanceSlider.min = hMinLog.toFixed(6);
    distanceSlider.max = hMaxLog.toFixed(6);
    distanceSlider.step = Math.max(1e-4, (hMaxLog - hMinLog) / 1000).toFixed(6);
    distanceSlider.value = distanceBandwidthLog; // Slider value is in log-space
    
    // Display linear equivalent for user
    const distanceBandwidthLinear = Math.exp(distanceBandwidthLog);
    document.getElementById('distance-bandwidth-value').textContent = distanceBandwidthLinear.toFixed(4);
  }
  
  // Return computed data for potential JSON export (bandwidths in linear space for display)
  const distanceBandwidthLinear = Math.exp(distanceBandwidthLog);
  const timeBandwidthLinear = hasValidTimeData ? Math.exp(timeBandwidthLog) : null;
  
  return {
    timeKDE: hasValidTimeData ? timeKDE : [],
    timePeaks: hasValidTimeData ? timePeaks : [],
    distanceKDE: distanceKDE,
    distancePeaks: distancePeaks,
    timeBandwidth: timeBandwidthLinear,
    distanceBandwidth: distanceBandwidthLinear
  };
}

/**
 * Resets a chart to its original state
 * @param {string} containerId - ID of the chart container to reset
 */
function resetChart(containerId) {
  const customReset = window[`${containerId}_reset`];
  if (typeof customReset === "function") {
    customReset();
    return;
  }
  const zoom = window[`${containerId}_zoom`];
  const g = window[`${containerId}_g`];
  
  if (zoom && g) {
    // Reset zoom transform to identity (no pan, no zoom)
    g.transition()
      .duration(300)
      .call(zoom.transform, d3.zoomIdentity);
  }
}

/**
 * Updates time delta KDE plot with new bandwidth
 * @param {number} bandwidthLog - New bandwidth value in log-space (slider value directly)
 */
function updateTimeKDE(bandwidthLog) {
  if (!window.kdeTimeDeltasSec || window.kdeTimeDeltasSec.length === 0) {
    return;
  }
  
  // Slider value is already in log-space, use directly
  window.kdeTimeBandwidthLog = bandwidthLog;
  
  // Recompute KDE with log-space bandwidth
  const timeKDE = computeKDE(window.kdeTimeDeltasSec, bandwidthLog);
  
  // Detect peaks
  const timePeaks = detectPeaks(timeKDE);
  
  // Re-render plot (pass raw data for rug plot)
  renderKDEPlot("time-kde-plot", timeKDE, timePeaks, window.kdeTimeDeltasSec, "Time Delta (seconds)", "Time Delta KDE");
  
  // Update slider value display (show linear equivalent)
  if (document.getElementById('time-bandwidth-value')) {
    const bandwidthLinear = Math.exp(bandwidthLog);
    document.getElementById('time-bandwidth-value').textContent = bandwidthLinear.toFixed(4);
  }
}

/**
 * Updates distance delta KDE plot with new bandwidth
 * @param {number} bandwidthLog - New bandwidth value in log-space (slider value directly)
 */
function updateDistanceKDE(bandwidthLog) {
  if (!window.kdeDistanceDeltasM || window.kdeDistanceDeltasM.length === 0) {
    return;
  }
  
  // Slider value is already in log-space, use directly
  window.kdeDistanceBandwidthLog = bandwidthLog;
  
  // Recompute KDE with log-space bandwidth
  const distanceKDE = computeKDE(window.kdeDistanceDeltasM, bandwidthLog);
  
  // Detect peaks
  const distancePeaks = detectPeaks(distanceKDE);
  
  // Re-render plot (pass raw data for rug plot)
  renderKDEPlot("distance-kde-plot", distanceKDE, distancePeaks, window.kdeDistanceDeltasM, "Distance Delta (meters)", "Distance Delta KDE");
  
  // Update slider value display (show linear equivalent)
  if (document.getElementById('distance-bandwidth-value')) {
    const bandwidthLinear = Math.exp(bandwidthLog);
    document.getElementById('distance-bandwidth-value').textContent = bandwidthLinear.toFixed(4);
  }
}

