# KDE Visualization Module

## Overview

The KDE Visualization Module provides pure observational visualization of sampling audit data using Kernel Density Estimation (KDE) and scatter plots. It computes KDE curves using Gaussian kernels in log space and renders interactive D3.js visualizations. The module follows a strict principle: show the data as it is without interpretation, classification, or thresholds.

## Purpose

This module serves to:
- Visualize time delta distributions using KDE plots
- Visualize distance delta distributions using KDE plots
- Visualize joint time-distance relationships using scatter plots
- Provide interactive panning and zooming capabilities
- Enable bandwidth adjustment for KDE smoothing
- Display empty state messages when data is unavailable

## Principles

- **Show the data as it is**: No interpretation, classification, or meaning inference
- **No bins or histograms**: Uses continuous KDE curves instead
- **No thresholds**: Does not classify data into categories
- **No smoothing except explicit KDE**: Only applies Gaussian kernel smoothing
- **No interpretation of peaks or outliers**: Peaks are detected but not interpreted

## Functions

### `computeKDE(data, bandwidth, numPoints = 200)`

Computes Kernel Density Estimate using Gaussian kernel in log space.

**Parameters:**
- `data` (Array<number>): Array of positive, finite values (linear space)
- `bandwidth` (number): Bandwidth parameter (h) in log space
- `numPoints` (number, optional): Number of evaluation points for KDE curve (default: 200)

**Returns:**
- `Array<{xLog: number, xLinear: number, y: number}>`: KDE curve points
  - `xLog`: x position in log space (for rendering)
  - `xLinear`: x position in linear space (for display/tooltips)
  - `y`: density value

**KDE Formula:**
```
f(x) = (1/nh) * Σ K((x - x_i) / h)
where K is the Gaussian kernel: K(u) = (1/√(2π)) * exp(-0.5 * u²)
```

**Computation Details:**
- All computation occurs in log space (ln(x))
- Evaluation grid spans exactly [min(log(data)), max(log(data))] - no padding
- Filters to only positive, finite values
- Returns empty array if no valid data

### `detectPeaks(kdePoints)`

Detects local maxima (peaks) in KDE curve.

**Parameters:**
- `kdePoints` (Array<{xLog: number, xLinear: number, y: number}>): KDE curve points (in log space)

**Returns:**
- `Array<{xLog: number, xLinear: number, y: number}>`: Peak locations

**Peak Detection:**
- A peak is a point where `y[i] > y[i-1] && y[i] > y[i+1]`
- Only checks interior points (skips first and last)
- Returns empty array if fewer than 3 points

### `renderKDEPlot(containerId, kdePoints, peaks, rawData, xLabel, title)`

Renders KDE plot with D3 using log-space x-axis.

**Parameters:**
- `containerId` (string): ID of container element
- `kdePoints` (Array<{xLog: number, xLinear: number, y: number}>): KDE curve points (in log space)
- `peaks` (Array<{xLog: number, xLinear: number, y: number}>): Peak locations (in log space)
- `rawData` (Array<number>): Raw data array in linear space for rug plot overlay
- `xLabel` (string): X-axis label (will be modified to indicate log scale)
- `title` (string): Plot title

**Features:**
- All geometry (KDE curve, rug ticks, peaks) uses log-space positions
- Display values (tooltips, axis labels) show linear-space values
- Interactive panning (zoom disabled, scale extent [1, 1])
- Rug plot overlay showing individual data points
- Peak markers (red dashed lines with circles)
- Tooltips showing linear-space values on hover

**Scaling:**
- X-axis uses `d3.scaleLinear()` with log-space domain
- Y-axis uses `d3.scaleLinear()` for density
- Axis tick labels convert log-space values to linear using `Math.exp()`

### `renderScatterPlot(containerId, pairs)`

Renders scatterplot of joint time-distance pairs.

**Parameters:**
- `containerId` (string): ID of container element
- `pairs` (Array<{dtSec: number, ddMeters: number}>): Time-distance pairs

**Features:**
- Both axes use log-space transformation (same approach as KDE)
- Uses `d3.scaleLinear()` with log-transformed data domains
- Interactive panning (zoom disabled, scale extent [1, 1])
- Tooltips showing time delta and distance delta values
- Pan-by-rescale only (no double application of transform)
- Degenerate domain prevention (prevents scale collapse)

**Scaling:**
- X-axis: "Time delta (seconds, log-scaled)"
- Y-axis: "Distance delta (meters, log-scaled)"
- Both axes use `safeLog(v) = Math.log(Math.max(1e-10, v))` for transformation
- Tick labels convert log-space values to linear using `Math.exp()`
- Compact numeric formatting (`.2g` format) with 5-6 ticks

**Panning Implementation:**
- Uses inner `zoomG` group for panning
- Pan-by-rescale: updates scale domains, resets `zoomG` transform
- Prevents degenerate domains (min span: 1e-10)
- Constrains domains to original domain bounds

### `renderEmptyChartWithMessage(containerId, chartType, message)`

Renders an empty chart with a message when data is unavailable.

**Parameters:**
- `containerId` (string): ID of container element
- `chartType` (string): Type of chart - "time-kde", "distance-kde", or "scatter"
- `message` (string): Message to display

**Features:**
- Renders appropriate axes for each chart type
- Displays message centered on chart
- Uses terminal theme (black background, white text)
- Proper axis labels for each chart type

### `visualizeSamplingData(samplingData, options = {})`

Main function to visualize sampling audit data.

**Parameters:**
- `samplingData` (Object): Object containing:
  - `timeDeltasMs` (Array<number>): Time deltas in milliseconds
  - `distanceDeltasM` (Array<number>): Distance deltas in meters
  - `timeDistancePairs` (Array<{dtSec: number, ddMeters: number}>): Joint pairs
- `options` (Object, optional): Visualization options
  - `timeBandwidth` (number): Bandwidth for time delta KDE (default: adaptive)
  - `distanceBandwidth` (number): Bandwidth for distance delta KDE (default: adaptive)

**Process:**
1. Converts time deltas from milliseconds to seconds
2. Transforms data to log space for bandwidth computation
3. Determines adaptive bandwidths using Silverman's rule of thumb (if not provided)
4. Computes KDE curves and detects peaks
5. Renders plots or empty state messages as appropriate
6. Stores data and bandwidths in `window` for slider updates

**Bandwidth Calculation:**
- Uses Silverman's rule: `h = 1.06 * σ * n^(-0.2)`
- Computed in log space
- Applied in log space for KDE computation

**Empty State Handling:**
- Time KDE: Renders empty chart if no valid time data
- Distance KDE: Renders empty chart if no valid distance data
- Scatter plot: Renders empty chart if no valid time data

### `resetChart(containerId)`

Resets chart zoom/pan to original view.

**Parameters:**
- `containerId` (string): ID of container element

**Features:**
- Smoothly transitions back to identity transform
- Uses D3 transition (300ms duration)
- Resets both zoom and pan

### `updateTimeKDE(bandwidthLog)`

Updates time delta KDE plot with new bandwidth.

**Parameters:**
- `bandwidthLog` (number): New bandwidth value in log-space (slider value directly)

**Process:**
1. Retrieves stored time delta data from `window.kdeTimeDeltasSec`
2. Recomputes KDE with new bandwidth
3. Detects peaks
4. Re-renders plot
5. Updates slider value display (shows linear equivalent)

### `updateDistanceKDE(bandwidthLog)`

Updates distance delta KDE plot with new bandwidth.

**Parameters:**
- `bandwidthLog` (number): New bandwidth value in log-space (slider value directly)

**Process:**
1. Retrieves stored distance delta data from `window.kdeDistanceDeltasM`
2. Recomputes KDE with new bandwidth
3. Detects peaks
4. Re-renders plot
5. Updates slider value display (shows linear equivalent)

## Log-Space Visualization Approach

### Why Log Space?

- Handles wide dynamic ranges (seconds to hours, meters to kilometers)
- Prevents condensation near origin
- Provides better visual distribution of data
- Consistent with KDE computation in log space

### Implementation Strategy

**"Log-transformed data in linear scale" approach:**
- Data is log-transformed: `logData = data.map(d => Math.log(d))`
- Scales use `d3.scaleLinear()` with log-space domains
- Positioning uses log-space values: `xScale(logData[i])`
- Display converts back to linear: `Math.exp(tickValue)`

**Consistency:**
- KDE plots and scatter plot use identical approach
- All axes follow same pattern
- Tooltips and labels show linear values
- Internal positioning uses log values

## Interactive Features

### Panning

- **KDE Plots**: Pan to inspect different ranges of the graph
- **Scatter Plot**: Pan to inspect different ranges of the graph
- Implemented using D3 zoom behavior with scale extent [1, 1] (zoom disabled)
- Pan-by-rescale: updates scale domains, resets visual transform

### Bandwidth Adjustment

- Sliders allow real-time bandwidth adjustment
- Updates KDE curves and peak detection
- Shows linear-space bandwidth value in display
- Slider values are in log-space

### Tooltips

- Show linear-space values on hover
- KDE plots: Show x value (linear) and density
- Scatter plot: Show time delta (seconds) and distance delta (meters)

## Empty State Handling

When data is unavailable, the module renders appropriate empty charts:

- **Time KDE**: "valid timestamps not found in gpx"
- **Distance KDE**: "no distance deltas in gpx"
- **Scatter Plot**: "valid timestamps not found in gpx"

Empty charts include:
- Proper axes with appropriate labels
- Centered message text
- Terminal theme styling

## Window Storage

The module stores data and state in `window` for slider updates:

- `window.kdeTimeDeltasSec`: Time deltas in seconds (for time KDE)
- `window.kdeTimeBandwidthLog`: Current time KDE bandwidth (log-space)
- `window.kdeDistanceDeltasM`: Distance deltas in meters (for distance KDE)
- `window.kdeDistanceBandwidthLog`: Current distance KDE bandwidth (log-space)
- `window[containerId + '_zoom']`: D3 zoom behavior instance
- `window[containerId + '_g']`: D3 group element for reset functionality

## Usage Example

```javascript
// After sampling audit
const samplingMetadata = auditSampling(points);

// Visualize data
visualizeSamplingData({
  timeDeltasMs: samplingMetadata.timeDeltasMs,
  distanceDeltasM: samplingMetadata.distanceDeltasM,
  timeDistancePairs: samplingMetadata.timeDistancePairs
}, {
  timeBandwidth: 0.5,      // Optional: linear-space bandwidth
  distanceBandwidth: 10.0  // Optional: linear-space bandwidth
});

// Update bandwidth via slider
updateTimeKDE(Math.log(0.7));      // Log-space bandwidth
updateDistanceKDE(Math.log(15.0)); // Log-space bandwidth

// Reset chart view
resetChart("time-kde-plot");
```

## Dependencies

- **D3.js**: For data visualization, scales, axes, zoom behavior, and SVG rendering
- Browser DOM APIs: For element selection and manipulation

## Chart Container IDs

Expected container IDs in HTML:
- `"time-kde-plot"`: Time delta KDE plot
- `"distance-kde-plot"`: Distance delta KDE plot
- `"time-distance-scatter"`: Scatter plot

## Notes

- All KDE computation occurs in log space for numerical stability
- Bandwidths are specified and stored in log space
- Display values (tooltips, labels) are always in linear space
- The module does not mutate input data
- Charts are redrawn completely on updates (no incremental updates)
- Peak detection is visual only (not interpreted)
- Rug plots show one tick per observation (no stacking or collision handling)
- Panning is constrained to original domain bounds
- Degenerate domains are prevented to avoid scale collapse
