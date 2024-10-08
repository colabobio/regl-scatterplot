import {
  hasSameElements,
  identity,
  max as maxArray,
  rangeMap,
  throttleAndDebounce,
  unionIntegers,
} from '@flekschas/utils';
import createDom2dCamera from 'dom-2d-camera';
import { mat4, vec4 } from 'gl-matrix';
import createPubSub from 'pub-sub-es';
import createLine from 'regl-line';

import BG_FS from './bg.fs';
import BG_VS from './bg.vs';
import createKdbush from './kdbush';
import POINT_SIMPLE_FS from './point-simple.fs';
import POINT_UPDATE_FS from './point-update.fs';
import POINT_UPDATE_VS from './point-update.vs';
import POINT_FS from './point.fs';
import createVertexShader from './point.vs';
import createRenderer from './renderer';

import createDirManager from './dir-manager';
// Point selectors
import createLassoManager from './lasso-manager';

import createSplineCurve from './spline-curve';

import {
  AUTO,
  CATEGORICAL,
  COLOR_ACTIVE_IDX,
  COLOR_BG_IDX,
  COLOR_HOVER_IDX,
  COLOR_NORMAL_IDX,
  COLOR_NUM_STATES,
  CONTINUOUS,
  DEFAULT_ANNOTATION_HVLINE_LIMIT,
  DEFAULT_ANNOTATION_LINE_COLOR,
  DEFAULT_ANNOTATION_LINE_WIDTH,
  DEFAULT_BACKGROUND_IMAGE,
  DEFAULT_COLOR_ACTIVE,
  DEFAULT_COLOR_BG,
  DEFAULT_COLOR_BY,
  DEFAULT_COLOR_HOVER,
  DEFAULT_COLOR_NORMAL,
  DEFAULT_DATA_ASPECT_RATIO,
  DEFAULT_DESELECT_ON_DBL_CLICK,
  DEFAULT_DESELECT_ON_ESCAPE,
  DEFAULT_DISTANCE,
  DEFAULT_EASING,
  DEFAULT_HEIGHT,
  DEFAULT_IMAGE_LOAD_TIMEOUT,
  DEFAULT_KEY_MAP,
  DEFAULT_MOUSE_MODE,
  DEFAULT_OPACITY_BY,
  DEFAULT_OPACITY_BY_DENSITY_DEBOUNCE_TIME,
  DEFAULT_OPACITY_BY_DENSITY_FILL,
  DEFAULT_OPACITY_INACTIVE_MAX,
  DEFAULT_OPACITY_INACTIVE_SCALE,
  DEFAULT_PERFORMANCE_MODE,
  DEFAULT_POINT_CONNECTION_COLOR_ACTIVE,
  DEFAULT_POINT_CONNECTION_COLOR_BY,
  DEFAULT_POINT_CONNECTION_COLOR_HOVER,
  DEFAULT_POINT_CONNECTION_COLOR_NORMAL,
  DEFAULT_POINT_CONNECTION_INT_POINTS_TOLERANCE,
  DEFAULT_POINT_CONNECTION_MAX_INT_POINTS_PER_SEGMENT,
  DEFAULT_POINT_CONNECTION_OPACITY,
  DEFAULT_POINT_CONNECTION_OPACITY_ACTIVE,
  DEFAULT_POINT_CONNECTION_OPACITY_BY,
  DEFAULT_POINT_CONNECTION_SIZE,
  DEFAULT_POINT_CONNECTION_SIZE_ACTIVE,
  DEFAULT_POINT_CONNECTION_SIZE_BY,
  DEFAULT_POINT_OUTLINE_WIDTH,
  DEFAULT_POINT_SIZE,
  DEFAULT_POINT_SIZE_MOUSE_DETECTION,
  DEFAULT_POINT_SIZE_SELECTED,
  DEFAULT_RETICLE_COLOR,
  DEFAULT_ROTATION,
  DEFAULT_SELECTION_TYPE,
  DEFAULT_SELECT_CLEAR_EVENT,
  DEFAULT_SELECT_COLOR,
  DEFAULT_SELECT_INITIATOR,
  DEFAULT_SELECT_LINE_WIDTH,
  DEFAULT_SELECT_LONG_PRESS_AFTER_EFFECT_TIME,
  DEFAULT_SELECT_LONG_PRESS_EFFECT_DELAY,
  DEFAULT_SELECT_LONG_PRESS_REVERT_EFFECT_TIME,
  DEFAULT_SELECT_LONG_PRESS_TIME,
  DEFAULT_SELECT_MIN_DELAY,
  DEFAULT_SELECT_MIN_DIST,
  DEFAULT_SELECT_ON_LONG_PRESS,
  DEFAULT_SHOW_POINT_CONNECTIONS,
  DEFAULT_SHOW_RETICLE,
  DEFAULT_SIZE_BY,
  DEFAULT_SPATIAL_INDEX_USE_WORKER,
  DEFAULT_TARGET,
  DEFAULT_VIEW,
  DEFAULT_WIDTH,
  DIRECTIONAL_SELECTION,
  EASING_FNS,
  ERROR_POINTS_NOT_DRAWN,
  FLOAT_BYTES,
  KEYS,
  KEY_ACTIONS,
  KEY_ACTION_MERGE,
  KEY_ACTION_ROTATE,
  KEY_ACTION_SELECT,
  KEY_ALT,
  KEY_CMD,
  KEY_CTRL,
  KEY_META,
  KEY_SHIFT,
  LASSO_SELECTION,
  LONG_CLICK_TIME,
  MIN_POINT_SIZE,
  MOUSE_MODES,
  MOUSE_MODE_PANZOOM,
  MOUSE_MODE_ROTATE,
  MOUSE_MODE_SELECT_DIRECTIONAL,
  MOUSE_MODE_SELECT_LASSO,
  MOUSE_SELECT_MODES,
  SELECT_CLEAR_EVENTS,
  SELECT_CLEAR_ON_DESELECT,
  SELECT_CLEAR_ON_END,
  SINGLE_CLICK_DELAY,
  VALUE_ZW_DATA_TYPES,
  W_NAMES,
  Z_NAMES,
} from './constants';

import {
  checkReglExtensions as checkSupport,
  clip,
  createRegl,
  createTextureFromUrl,
  dist,
  flipObj,
  getBBox,
  isConditionalArray,
  isDomRect,
  isHorizontalLine,
  isMultipleColors,
  isPointInPolygon,
  isPolygon,
  isPositiveNumber,
  isRect,
  isStrictlyPositiveNumber,
  isString,
  isValidBBox,
  isVerticalLine,
  limit,
  max,
  min,
  rgbBrightness,
  toArrayOrientedPoints,
  toRgba,
} from './utils';

import { version } from '../package.json';

const deprecations = {
  showRecticle: 'showReticle',
  recticleColor: 'reticleColor',
};

const checkDeprecations = (properties) => {
  const deprecatedProps = Object.keys(properties).filter(
    (prop) => deprecations[prop],
  );

  for (const prop of deprecatedProps) {
    console.warn(
      `regl-scatterplot: the "${prop}" property is deprecated. Please use "${deprecations[prop]}" instead.`,
    );
    properties[deprecations[prop]] = properties[prop];
    delete properties[prop];
  }
};

const getEncodingType = (
  type,
  defaultValue,
  { allowSegment = false, allowDensity = false, allowInherit = false } = {},
) => {
  // Z refers to the 3rd component of the RGBA value
  if (Z_NAMES.has(type)) {
    return 'valueZ';
  }

  // W refers to the 4th component of the RGBA value
  if (W_NAMES.has(type)) {
    return 'valueW';
  }

  if (type === 'segment') {
    return allowSegment ? 'segment' : defaultValue;
  }

  if (type === 'density') {
    return allowDensity ? 'density' : defaultValue;
  }

  if (type === 'inherit') {
    return allowInherit ? 'inherit' : defaultValue;
  }

  return defaultValue;
};

const getEncodingIdx = (type) => {
  switch (type) {
    case 'valueZ':
      return 2;

    case 'valueW':
      return 3;

    default:
      return null;
  }
};

const createScatterplot = (
  /** @type {Partial<import('./types').Properties>} */ initialProperties = {},
) => {
  /** @type {import('pub-sub-es').PubSub<import('./types').Events>} */
  const pubSub = createPubSub({
    async: !initialProperties.syncEvents,
    caseInsensitive: true,
  });
  const scratch = new Float32Array(16);
  const pvm = new Float32Array(16);
  const mousePosition = [0, 0];

  checkDeprecations(initialProperties);

  let {
    renderer,
    backgroundColor = DEFAULT_COLOR_BG,
    backgroundImage = DEFAULT_BACKGROUND_IMAGE,
    canvas = document.createElement('canvas'),
    colorBy = DEFAULT_COLOR_BY,
    deselectOnDblClick = DEFAULT_DESELECT_ON_DBL_CLICK,
    deselectOnEscape = DEFAULT_DESELECT_ON_ESCAPE,
    selectColor = DEFAULT_SELECT_COLOR,
    selectLineWidth = DEFAULT_SELECT_LINE_WIDTH,
    selectMinDelay = DEFAULT_SELECT_MIN_DELAY,
    selectMinDist = DEFAULT_SELECT_MIN_DIST,
    selectClearEvent = DEFAULT_SELECT_CLEAR_EVENT,
    selectInitiator = DEFAULT_SELECT_INITIATOR,
    selectInitiatorParentElement = document.body,
    selectOnLongPress = DEFAULT_SELECT_ON_LONG_PRESS,
    selectLongPressTime = DEFAULT_SELECT_LONG_PRESS_TIME,
    selectLongPressAfterEffectTime = DEFAULT_SELECT_LONG_PRESS_AFTER_EFFECT_TIME,
    selectLongPressEffectDelay = DEFAULT_SELECT_LONG_PRESS_EFFECT_DELAY,
    selectLongPressRevertEffectTime = DEFAULT_SELECT_LONG_PRESS_REVERT_EFFECT_TIME,
    keyMap = DEFAULT_KEY_MAP,
    mouseMode = DEFAULT_MOUSE_MODE,
    showReticle = DEFAULT_SHOW_RETICLE,
    reticleColor = DEFAULT_RETICLE_COLOR,
    pointColor = DEFAULT_COLOR_NORMAL,
    pointColorActive = DEFAULT_COLOR_ACTIVE,
    pointColorHover = DEFAULT_COLOR_HOVER,
    showPointConnections = DEFAULT_SHOW_POINT_CONNECTIONS,
    pointConnectionColor = DEFAULT_POINT_CONNECTION_COLOR_NORMAL,
    pointConnectionColorActive = DEFAULT_POINT_CONNECTION_COLOR_ACTIVE,
    pointConnectionColorHover = DEFAULT_POINT_CONNECTION_COLOR_HOVER,
    pointConnectionColorBy = DEFAULT_POINT_CONNECTION_COLOR_BY,
    pointConnectionOpacity = DEFAULT_POINT_CONNECTION_OPACITY,
    pointConnectionOpacityBy = DEFAULT_POINT_CONNECTION_OPACITY_BY,
    pointConnectionOpacityActive = DEFAULT_POINT_CONNECTION_OPACITY_ACTIVE,
    pointConnectionSize = DEFAULT_POINT_CONNECTION_SIZE,
    pointConnectionSizeActive = DEFAULT_POINT_CONNECTION_SIZE_ACTIVE,
    pointConnectionSizeBy = DEFAULT_POINT_CONNECTION_SIZE_BY,
    pointConnectionMaxIntPointsPerSegment = DEFAULT_POINT_CONNECTION_MAX_INT_POINTS_PER_SEGMENT,
    pointConnectionTolerance = DEFAULT_POINT_CONNECTION_INT_POINTS_TOLERANCE,
    pointSize = DEFAULT_POINT_SIZE,
    pointSizeSelected = DEFAULT_POINT_SIZE_SELECTED,
    pointSizeMouseDetection = DEFAULT_POINT_SIZE_MOUSE_DETECTION,
    pointOutlineWidth = DEFAULT_POINT_OUTLINE_WIDTH,
    opacity = AUTO,
    opacityBy = DEFAULT_OPACITY_BY,
    opacityByDensityFill = DEFAULT_OPACITY_BY_DENSITY_FILL,
    opacityInactiveMax = DEFAULT_OPACITY_INACTIVE_MAX,
    opacityInactiveScale = DEFAULT_OPACITY_INACTIVE_SCALE,
    sizeBy = DEFAULT_SIZE_BY,
    height = DEFAULT_HEIGHT,
    width = DEFAULT_WIDTH,
    annotationLineColor = DEFAULT_ANNOTATION_LINE_COLOR,
    annotationLineWidth = DEFAULT_ANNOTATION_LINE_WIDTH,
    annotationHVLineLimit = DEFAULT_ANNOTATION_HVLINE_LIMIT,
    selectionType = DEFAULT_SELECTION_TYPE,
  } = initialProperties;

  let currentWidth = width === AUTO ? 1 : width;
  let currentHeight = height === AUTO ? 1 : height;

  // The following properties cannot be changed after the initialization
  const {
    performanceMode = DEFAULT_PERFORMANCE_MODE,
    opacityByDensityDebounceTime = DEFAULT_OPACITY_BY_DENSITY_DEBOUNCE_TIME,
    spatialIndexUseWorker = DEFAULT_SPATIAL_INDEX_USE_WORKER,
  } = initialProperties;

  mouseMode = limit(MOUSE_MODES, MOUSE_MODE_PANZOOM)(mouseMode);

  if (!renderer) {
    renderer = createRenderer({
      regl: initialProperties.regl,
      gamma: initialProperties.gamma,
    });
  }

  backgroundColor = toRgba(backgroundColor, true);
  selectColor = toRgba(selectColor, true);
  reticleColor = toRgba(reticleColor, true);

  let isDestroyed = false;
  let backgroundColorBrightness = rgbBrightness(backgroundColor);
  let camera;
  /** @type {ReturnType<createLine>} */
  let selectionOutline;
  /** @type {ReturnType<createLine>} */
  let annotations;
  let mouseDown = false;
  let mouseDownTime = null;
  let mouseDownPosition = [0, 0];
  let mouseDownTimeout = -1;
  /** @type{number[]} */
  let selectedPoints = [];
  /** @type{Set<number>} */
  const selectedPointsSet = new Set();
  /** @type{Set<number>} */
  const selectedPointsConnectionSet = new Set();
  let isPointsFiltered = false;
  /** @type{Set<number>} */
  const filteredPointsSet = new Set();
  let points = [];
  let numPoints = 0;
  let numPointsInView = 0;
  let selectionActive = false;
  let selectionPointsCurr = [];
  let selectionCenterPointsCurr = [];
  let spatialIndex;
  let viewAspectRatio;
  let dataAspectRatio =
    initialProperties.aspectRatio || DEFAULT_DATA_ASPECT_RATIO;
  let projectionLocal;
  let projection;
  let model;
  let pointConnections;
  let pointConnectionMap;
  let computingPointConnectionCurves;
  // biome-ignore lint/style/useNamingConvention: HLine stands for HorizontalLine
  let reticleHLine;
  // biome-ignore lint/style/useNamingConvention: VLine stands for VerticalLine
  let reticleVLine;
  let computedPointSizeMouseDetection;
  let keyActionMap = flipObj(keyMap);
  let selectInitiatorTimeout;
  let topRightNdc;
  let bottomLeftNdc;
  let preventEventView = false;
  let draw = true;
  let drawReticleOnce = false;
  let canvasObserver;

  pointColor = isMultipleColors(pointColor) ? [...pointColor] : [pointColor];
  pointColorActive = isMultipleColors(pointColorActive)
    ? [...pointColorActive]
    : [pointColorActive];
  pointColorHover = isMultipleColors(pointColorHover)
    ? [...pointColorHover]
    : [pointColorHover];

  pointColor = pointColor.map((color) => toRgba(color, true));
  pointColorActive = pointColorActive.map((color) => toRgba(color, true));
  pointColorHover = pointColorHover.map((color) => toRgba(color, true));

  opacity =
    !Array.isArray(opacity) && Number.isNaN(+opacity)
      ? pointColor[0][3]
      : opacity;
  opacity = isConditionalArray(opacity, isPositiveNumber, {
    minLength: 1,
  })
    ? [...opacity]
    : [opacity];

  pointSize = isConditionalArray(pointSize, isPositiveNumber, {
    minLength: 1,
  })
    ? [...pointSize]
    : [pointSize];

  let minPointScale = MIN_POINT_SIZE / pointSize[0];

  if (pointConnectionColor === 'inherit') {
    pointConnectionColor = [...pointColor];
  } else {
    pointConnectionColor = isMultipleColors(pointConnectionColor)
      ? [...pointConnectionColor]
      : [pointConnectionColor];
    pointConnectionColor = pointConnectionColor.map((color) =>
      toRgba(color, true),
    );
  }

  if (pointConnectionColorActive === 'inherit') {
    pointConnectionColorActive = [...pointColorActive];
  } else {
    pointConnectionColorActive = isMultipleColors(pointConnectionColorActive)
      ? [...pointConnectionColorActive]
      : [pointConnectionColorActive];
    pointConnectionColorActive = pointConnectionColorActive.map((color) =>
      toRgba(color, true),
    );
  }

  if (pointConnectionColorHover === 'inherit') {
    pointConnectionColorHover = [...pointColorHover];
  } else {
    pointConnectionColorHover = isMultipleColors(pointConnectionColorHover)
      ? [...pointConnectionColorHover]
      : [pointConnectionColorHover];
    pointConnectionColorHover = pointConnectionColorHover.map((color) =>
      toRgba(color, true),
    );
  }

  if (pointConnectionOpacity === 'inherit') {
    pointConnectionOpacity = [...opacity];
  } else {
    pointConnectionOpacity = isConditionalArray(
      pointConnectionOpacity,
      isPositiveNumber,
      {
        minLength: 1,
      },
    )
      ? [...pointConnectionOpacity]
      : [pointConnectionOpacity];
  }

  if (pointConnectionSize === 'inherit') {
    pointConnectionSize = [...pointSize];
  } else {
    pointConnectionSize = isConditionalArray(
      pointConnectionSize,
      isPositiveNumber,
      {
        minLength: 1,
      },
    )
      ? [...pointConnectionSize]
      : [pointConnectionSize];
  }

  colorBy = getEncodingType(colorBy, DEFAULT_COLOR_BY);
  opacityBy = getEncodingType(opacityBy, DEFAULT_OPACITY_BY, {
    allowDensity: true,
  });
  sizeBy = getEncodingType(sizeBy, DEFAULT_SIZE_BY);

  pointConnectionColorBy = getEncodingType(
    pointConnectionColorBy,
    DEFAULT_POINT_CONNECTION_COLOR_BY,
    { allowSegment: true, allowInherit: true },
  );
  pointConnectionOpacityBy = getEncodingType(
    pointConnectionOpacityBy,
    DEFAULT_POINT_CONNECTION_OPACITY_BY,
    { allowSegment: true },
  );
  pointConnectionSizeBy = getEncodingType(
    pointConnectionSizeBy,
    DEFAULT_POINT_CONNECTION_SIZE_BY,
    { allowSegment: true },
  );

  let stateTex; // Stores the point texture holding x, y, category, and value
  let prevStateTex; // Stores the previous point texture. Used for transitions
  let tmpStateTex; // Stores a temporary point texture. Used for transitions
  let tmpStateBuffer; // Temporary frame buffer
  let stateTexRes = 0; // Width and height of the texture
  let stateTexEps = 0; // Half a texel
  let normalPointsIndexBuffer; // Buffer holding the indices pointing to the correct texel
  let selectedPointsIndexBuffer; // Used for pointing to the selected texels
  let hoveredPointIndexBuffer; // Used for pointing to the hovered texels

  let cameraZoomTargetStart; // Stores the start (i.e., current) camera target for zooming
  let cameraZoomTargetEnd; // Stores the end camera target for zooming
  let cameraZoomDistanceStart; // Stores the start camera distance for zooming
  let cameraZoomDistanceEnd; // Stores the end camera distance for zooming

  let isTransitioning = false;
  let transitionStartTime = null;
  let transitionDuration;
  let transitionEasing;
  let preTransitionShowReticle = showReticle;

  let colorTex; // Stores the point color texture
  let colorTexRes = 0; // Width and height of the texture
  let encodingTex; // Stores the point sizes and opacity values
  let encodingTexRes = 0; // Width and height of the texture

  let isViewChanged = false;
  let isPointsDrawn = false;
  let isAnnotationsDrawn = false;
  let isMouseOverCanvasChecked = false;

  // biome-ignore lint/style/useNamingConvention: ZDate is not one word
  let valueZDataType = CATEGORICAL;
  // biome-ignore lint/style/useNamingConvention: WDate is not one word
  let valueWDataType = CATEGORICAL;

  /** @type{number|undefined} */
  let hoveredPoint;
  let isMouseInCanvas = false;

  let xScale = initialProperties.xScale || null;
  let yScale = initialProperties.yScale || null;
  let xDomainStart = 0;
  let xDomainSize = 0;
  let yDomainStart = 0;
  let yDomainSize = 0;
  if (xScale) {
    xDomainStart = xScale.domain()[0];
    xDomainSize = xScale.domain()[1] - xScale.domain()[0];
    xScale.range([0, currentWidth]);
  }
  if (yScale) {
    yDomainStart = yScale.domain()[0];
    yDomainSize = yScale.domain()[1] - yScale.domain()[0];
    yScale.range([currentHeight, 0]);
  }

  const getNdcX = (x) => -1 + (x / currentWidth) * 2;
  const getNdcY = (y) => 1 + (y / currentHeight) * -2;

  // Get relative WebGL position
  const getMouseGlPos = () => [
    getNdcX(mousePosition[0]),
    getNdcY(mousePosition[1]),
  ];

  const getScatterGlPos = (xGl, yGl) => {
    // Homogeneous vector
    const v = [xGl, yGl, 1, 1];

    // projection^-1 * view^-1 * model^-1 is the same as
    // model * view^-1 * projection
    const mvp = mat4.invert(
      scratch,
      mat4.multiply(
        scratch,
        projectionLocal,
        mat4.multiply(scratch, camera.view, model),
      ),
    );

    // Translate vector
    vec4.transformMat4(v, v, mvp);

    return v.slice(0, 2);
  };

  const getPointSizeNdc = (pointSizeIncrease = 0) => {
    const pointScale = getPointScale();

    // The height of the view in normalized device coordinates
    const heightNdc = topRightNdc[1] - bottomLeftNdc[1];
    // The size of a pixel in the current view in normalized device coordinates
    const pxNdc = heightNdc / canvas.height;
    // The scaled point size in normalized device coordinates
    return (
      (computedPointSizeMouseDetection * pointScale + pointSizeIncrease) * pxNdc
    );
  };

  const getPoints = () => {
    if (isPointsFiltered) {
      return points.filter((_, i) => filteredPointsSet.has(i));
    }
    return points;
  };

  // biome-ignore lint/style/useNamingConvention: BBox stands for BoundingBox
  const getPointsInBBox = (x0, y0, x1, y1) => {
    // biome-ignore lint/style/useNamingConvention: BBox stands for BoundingBox
    const pointsInBBox = spatialIndex.range(x0, y0, x1, y1);
    if (isPointsFiltered) {
      return pointsInBBox.filter((i) => filteredPointsSet.has(i));
    }
    return pointsInBBox;
  };

  const raycast = () => {
    const [xGl, yGl] = getMouseGlPos();
    const [xNdc, yNdc] = getScatterGlPos(xGl, yGl);

    const pointSizeNdc = getPointSizeNdc(4);

    // Get all points within a close range
    // biome-ignore lint/style/useNamingConvention: BBox stands for BoundingBox
    const pointsInBBox = getPointsInBBox(
      xNdc - pointSizeNdc,
      yNdc - pointSizeNdc,
      xNdc + pointSizeNdc,
      yNdc + pointSizeNdc,
    );

    // Find the closest point
    let minDist = pointSizeNdc;
    let clostestPointIdx = -1;
    for (const pointIdx of pointsInBBox) {
      const [ptX, ptY] = points[pointIdx];
      const d = dist(ptX, ptY, xNdc, yNdc);
      if (d < minDist) {
        minDist = d;
        clostestPointIdx = pointIdx;
      }
    }

    return clostestPointIdx;
  };

  const hasPointConnections = (point) => point && point.length > 4;

  const setPointConnectionColorState = (pointIdxs, stateIndex) => {
    if (
      computingPointConnectionCurves ||
      !showPointConnections ||
      !hasPointConnections(points[pointIdxs[0]])
    ) {
      return;
    }

    const isNormal = stateIndex === 0;
    const lineIdCacher =
      stateIndex === 1
        ? (lineId) => selectedPointsConnectionSet.add(lineId)
        : identity;

    // Get line IDs
    const lineIds = Object.keys(
      pointIdxs.reduce((ids, pointIdx) => {
        const point = points[pointIdx];
        const isStruct = Array.isArray(point[4]);
        const lineId = isStruct ? point[4][0] : point[4];

        ids[lineId] = true;

        return ids;
      }, {}),
    );

    const buffer = pointConnections.getData().opacities;

    const unselectedLineIds = lineIds.filter(
      (lineId) => !selectedPointsConnectionSet.has(+lineId),
    );

    for (const lineId of unselectedLineIds) {
      const index = pointConnectionMap[lineId][0];
      const numPointPerLine = pointConnectionMap[lineId][2];
      const pointOffset = pointConnectionMap[lineId][3];

      const bufferStart = index * 4 + pointOffset * 2;
      const bufferEnd = bufferStart + numPointPerLine * 2 + 4;

      if (buffer.__original__ === undefined) {
        buffer.__original__ = buffer.slice();
      }

      for (let i = bufferStart; i < bufferEnd; i++) {
        // buffer[i] = Math.floor(buffer[i] / 4) * 4 + stateIndex;
        buffer[i] = isNormal
          ? buffer.__original__[i]
          : pointConnectionOpacityActive;
      }

      lineIdCacher(lineId);
    }

    pointConnections.getBuffer().opacities.subdata(buffer, 0);
  };

  const indexToStateTexCoord = (index) => [
    (index % stateTexRes) / stateTexRes + stateTexEps,
    Math.floor(index / stateTexRes) / stateTexRes + stateTexEps,
  ];

  const isPointsFilteredOut = (pointIdx) =>
    isPointsFiltered && !filteredPointsSet.has(pointIdx);

  const selectionClear = () => {
    selectionPointsCurr = [];
    selectionCenterPointsCurr = [];
    if (selectionOutline) {
      selectionOutline.clear();
    }
  };

  const deselect = ({ preventEvent = false } = {}) => {
    if (selectClearEvent === SELECT_CLEAR_ON_DESELECT) {
      selectionClear();
    }
    if (selectedPoints.length) {
      if (!preventEvent) {
        pubSub.publish('deselect');
      }
      selectedPointsConnectionSet.clear();
      setPointConnectionColorState(selectedPoints, 0);
      selectedPoints = [];
      selectedPointsSet.clear();
      draw = true;
    }
  };

  /**
   * Select and highlight a set of points
   * @param {number | number[]} pointIdxs
   * @param {import('./types').ScatterplotMethodOptions['select']}
   */
  const select = (pointIdxs, { merge = false, preventEvent = false } = {}) => {
    const newSelectedPoints = Array.isArray(pointIdxs)
      ? pointIdxs
      : [pointIdxs];
    const currSelectedPoints = [...selectedPoints];

    if (merge) {
      selectedPoints = unionIntegers(selectedPoints, newSelectedPoints);
      if (currSelectedPoints.length === selectedPoints.length) {
        draw = true;
        return;
      }
    } else {
      // Unset previously highlight point connections
      if (selectedPoints?.length) {
        setPointConnectionColorState(selectedPoints, 0);
      }
      if (currSelectedPoints.length > 0 && newSelectedPoints.length === 0) {
        deselect({ preventEvent });
        return;
      }
      selectedPoints = newSelectedPoints;
    }

    if (hasSameElements(currSelectedPoints, selectedPoints)) {
      draw = true;
      return;
    }

    const selectedPointsBuffer = [];

    selectedPointsSet.clear();
    selectedPointsConnectionSet.clear();

    for (let i = selectedPoints.length - 1; i >= 0; i--) {
      const pointIdx = selectedPoints[i];

      if (
        pointIdx < 0 ||
        pointIdx >= numPoints ||
        isPointsFilteredOut(pointIdx)
      ) {
        // Remove invalid selected points
        selectedPoints.splice(i, 1);
        continue;
      }

      selectedPointsSet.add(pointIdx);
      selectedPointsBuffer.push.apply(
        selectedPointsBuffer,
        indexToStateTexCoord(pointIdx),
      );
    }

    selectedPointsIndexBuffer({
      usage: 'dynamic',
      type: 'float',
      data: selectedPointsBuffer,
    });

    setPointConnectionColorState(selectedPoints, 1);

    if (!preventEvent) {
      pubSub.publish('select', { points: selectedPoints });
    }

    draw = true;
  };

  /**
   * @param {number} point
   * @param {import('./types').ScatterplotMethodOptions['hover']} options
   */
  const hover = (
    point,
    { showReticleOnce = false, preventEvent = false } = {},
  ) => {
    let needsRedraw = false;

    const isFilteredOut = isPointsFiltered && !filteredPointsSet.has(point);

    if (!isFilteredOut && point >= 0 && point < numPoints) {
      needsRedraw = true;
      const oldHoveredPoint = hoveredPoint;
      const newHoveredPoint = point !== hoveredPoint;
      if (
        +oldHoveredPoint >= 0 &&
        newHoveredPoint &&
        !selectedPointsSet.has(oldHoveredPoint)
      ) {
        setPointConnectionColorState([oldHoveredPoint], 0);
      }
      hoveredPoint = point;
      hoveredPointIndexBuffer.subdata(indexToStateTexCoord(point));
      if (!selectedPointsSet.has(point)) {
        setPointConnectionColorState([point], 2);
      }
      if (newHoveredPoint && !preventEvent) {
        pubSub.publish('pointover', hoveredPoint);
      }
    } else {
      needsRedraw = +hoveredPoint >= 0;
      if (needsRedraw) {
        if (!selectedPointsSet.has(hoveredPoint)) {
          setPointConnectionColorState([hoveredPoint], 0);
        }
        if (!preventEvent) {
          pubSub.publish('pointout', hoveredPoint);
        }
      }
      hoveredPoint = undefined;
    }

    if (needsRedraw) {
      draw = true;
      drawReticleOnce = showReticleOnce;
    }
  };

  const getRelativeMousePosition = (event) => {
    const rect = canvas.getBoundingClientRect();

    mousePosition[0] = event.clientX - rect.left;
    mousePosition[1] = event.clientY - rect.top;

    return [...mousePosition];
  };

  const findPointsInSelection = (selectionPolygon) => {
    // get the bounding box of the point selection...
    const bBox = getBBox(selectionPolygon);

    if (!isValidBBox(bBox)) {
      return [];
    }

    // ...to efficiently preselect potentially selected points
    // biome-ignore lint/style/useNamingConvention: BBox stands for BoundingBox
    const pointsInBBox = getPointsInBBox(...bBox);
    // next we test each point in the bounding box if it is in the polygon too
    const pointsInPolygon = [];
    for (const pointIdx of pointsInBBox) {
      if (isPointInPolygon(selectionPolygon, points[pointIdx])) {
        pointsInPolygon.push(pointIdx);
      }
    }

    return pointsInPolygon;
  };

  const selectionStart = () => {
    // Fix camera for the selection
    camera.config({ isFixed: true });
    mouseDown = true;
    selectionActive = true;
    selectionClear();
    if (mouseDownTimeout >= 0) {
      clearTimeout(mouseDownTimeout);
      mouseDownTimeout = -1;
    }
    pubSub.publish('selectionStart');
  };

  const selectionExtend = (
    selPoints,
    selPointsFlat,
    centerPositions = null,
  ) => {
    selectionPointsCurr = [...selPoints];
    if (centerPositions) {
      selectionCenterPointsCurr = [...centerPositions];
    } else {
      selectionCenterPointsCurr = [];
    }
    selectionOutline.setPoints(selPointsFlat);
    pubSub.publish('selectionExtend', { coordinates: selPoints });
  };

  const selectionEnd = (
    selPoints,
    selPointsFlat,
    { merge = false } = {},
    centerPositions = null,
  ) => {
    camera.config({ isFixed: false });
    selectionPointsCurr = [...selPoints];
    if (centerPositions) {
      selectionCenterPointsCurr = [...centerPositions];
    } else {
      selectionCenterPointsCurr = [];
    }
    const pointsInSelection = findPointsInSelection(selPointsFlat);
    select(pointsInSelection, { merge });

    pubSub.publish('selectionEnd', {
      coordinates: selectionPointsCurr,
      centers: selectionCenterPointsCurr,
    });
    if (selectClearEvent === SELECT_CLEAR_ON_END) {
      selectionClear();
    }
  };

  // Lasso is the default selection manager
  let selectionManager = createLassoManager(canvas, {
    onStart: selectionStart,
    onDraw: selectionExtend,
    onEnd: selectionEnd,
    enableInitiator: selectInitiator,
    initiatorParentElement: selectInitiatorParentElement,
    pointNorm: ([x, y]) => getScatterGlPos(getNdcX(x), getNdcY(y)),
  });

  const checkSelectionMode = () =>
    mouseMode === MOUSE_MODE_SELECT_LASSO ||
    mouseMode === MOUSE_MODE_SELECT_DIRECTIONAL;

  const checkModKey = (event, action) => {
    switch (keyActionMap[action]) {
      case KEY_ALT:
        return event.altKey;

      case KEY_CMD:
        return event.metaKey;

      case KEY_CTRL:
        return event.ctrlKey;

      case KEY_META:
        return event.metaKey;

      case KEY_SHIFT:
        return event.shiftKey;

      default:
        return false;
    }
  };

  const checkIfMouseIsOverCanvas = (event) =>
    document
      .elementsFromPoint(event.clientX, event.clientY)
      .some((element) => element === canvas);

  const mouseDownHandler = (event) => {
    if (!isPointsDrawn || event.buttons !== 1) {
      return;
    }

    mouseDown = true;
    mouseDownTime = performance.now();

    mouseDownPosition = getRelativeMousePosition(event);

    selectionActive =
      checkSelectionMode() || checkModKey(event, KEY_ACTION_SELECT);

    if (!selectionActive && selectOnLongPress) {
      selectionManager.showLongPressIndicator(event.clientX, event.clientY, {
        time: selectLongPressTime,
        extraTime: selectLongPressAfterEffectTime,
        delay: selectLongPressEffectDelay,
      });
      mouseDownTimeout = setTimeout(() => {
        mouseDownTimeout = -1;
        selectionActive = true;
      }, selectLongPressTime);
    }
  };

  const mouseUpHandler = (event) => {
    if (!isPointsDrawn) {
      return;
    }

    mouseDown = false;
    if (mouseDownTimeout >= 0) {
      clearTimeout(mouseDownTimeout);
      mouseDownTimeout = -1;
    }

    if (selectionActive) {
      event.preventDefault();
      selectionActive = false;
      selectionManager.end({
        merge: checkModKey(event, KEY_ACTION_MERGE),
      });
    }

    if (selectOnLongPress) {
      selectionManager.hideLongPressIndicator({
        time: selectLongPressRevertEffectTime,
      });
    }
  };

  const mouseClickHandler = (event) => {
    if (!isPointsDrawn) {
      return;
    }

    event.preventDefault();

    const currentMousePosition = getRelativeMousePosition(event);

    if (dist(...currentMousePosition, ...mouseDownPosition) >= selectMinDist) {
      return;
    }

    const clickTime = performance.now() - mouseDownTime;

    if (!selectInitiator || clickTime < LONG_CLICK_TIME) {
      // If the user clicked normally (i.e., fast) we'll only show the selector
      // initiator if the use click into the void
      const clostestPoint = raycast();
      if (clostestPoint >= 0) {
        if (
          selectedPoints.length &&
          selectClearEvent === SELECT_CLEAR_ON_DESELECT
        ) {
          // Special case where we silently "deselect" the previous points by
          // overriding the selected points. Hence, we need to clear the selector.
          selectionClear();
        }
        select([clostestPoint], {
          merge: checkModKey(event, KEY_ACTION_MERGE),
        });
      } else if (!selectInitiatorTimeout) {
        // We'll also wait to make sure the user didn't double click
        selectInitiatorTimeout = setTimeout(() => {
          selectInitiatorTimeout = null;
          selectionManager.showInitiator(event);
        }, SINGLE_CLICK_DELAY);
      }
    }
  };

  const mouseDblClickHandler = (event) => {
    selectionManager.hideInitiator();
    if (selectInitiatorTimeout) {
      clearTimeout(selectInitiatorTimeout);
      selectInitiatorTimeout = null;
    }
    if (deselectOnDblClick) {
      event.preventDefault();
      deselect();
    }
  };

  const mouseMoveHandler = (event) => {
    if (!isMouseOverCanvasChecked) {
      isMouseInCanvas = checkIfMouseIsOverCanvas(event);
      isMouseOverCanvasChecked = true;
    }
    if (!(isPointsDrawn && (isMouseInCanvas || mouseDown))) {
      return;
    }

    const currentMousePosition = getRelativeMousePosition(event);
    const mouseMoveDist = dist(...currentMousePosition, ...mouseDownPosition);
    const mouseMovedMin = mouseMoveDist >= selectMinDist;

    // Only ray cast if the mouse cursor is inside
    if (isMouseInCanvas && !selectionActive) {
      hover(raycast()); // eslint-disable-line no-use-before-define
    }

    if (selectionActive) {
      event.preventDefault();
      selectionManager.extend(event, true);
    } else if (mouseDown && selectOnLongPress && mouseMovedMin) {
      selectionManager.hideLongPressIndicator({
        time: selectLongPressRevertEffectTime,
      });
    }

    if (mouseDownTimeout >= 0 && mouseMovedMin) {
      clearTimeout(mouseDownTimeout);
      mouseDownTimeout = -1;
    }

    // Always redraw when mousedown as the user might have panned or selected
    if (mouseDown) {
      draw = true;
    }
  };

  const blurHandler = () => {
    hoveredPoint = undefined;
    isMouseInCanvas = false;
    isMouseOverCanvasChecked = false;

    if (!isPointsDrawn) {
      return;
    }

    if (+hoveredPoint >= 0 && !selectedPointsSet.has(hoveredPoint)) {
      setPointConnectionColorState([hoveredPoint], 0);
    }
    mouseUpHandler();
    draw = true;
  };

  const createEncodingTexture = () => {
    const maxEncoding = Math.max(pointSize.length, opacity.length);

    encodingTexRes = Math.max(2, Math.ceil(Math.sqrt(maxEncoding)));
    const rgba = new Float32Array(encodingTexRes ** 2 * 4);

    for (let i = 0; i < maxEncoding; i++) {
      rgba[i * 4] = pointSize[i] || 0;
      rgba[i * 4 + 1] = Math.min(1, opacity[i] || 0);

      const activeOpacity = Number(
        (pointColorActive[i] || pointColorActive[0])[3],
      );
      rgba[i * 4 + 2] = Math.min(
        1,
        Number.isNaN(activeOpacity) ? 1 : activeOpacity,
      );

      const hoverOpacity = Number(
        (pointColorHover[i] || pointColorHover[0])[3],
      );
      rgba[i * 4 + 3] = Math.min(
        1,
        Number.isNaN(hoverOpacity) ? 1 : hoverOpacity,
      );
    }

    return renderer.regl.texture({
      data: rgba,
      shape: [encodingTexRes, encodingTexRes, 4],
      type: 'float',
    });
  };

  const getColors = (
    baseColor = pointColor,
    activeColor = pointColorActive,
    hoverColor = pointColorHover,
  ) => {
    const n = baseColor.length;
    const n2 = activeColor.length;
    const n3 = hoverColor.length;
    const colors = [];
    if (n === n2 && n2 === n3) {
      for (let i = 0; i < n; i++) {
        colors.push(
          baseColor[i],
          activeColor[i],
          hoverColor[i],
          backgroundColor,
        );
      }
    } else {
      for (let i = 0; i < n; i++) {
        const rgbaOpaque = [
          baseColor[i][0],
          baseColor[i][1],
          baseColor[i][2],
          1,
        ];
        const colorActive =
          colorBy === DEFAULT_COLOR_BY ? activeColor[0] : rgbaOpaque;
        const colorHover =
          colorBy === DEFAULT_COLOR_BY ? hoverColor[0] : rgbaOpaque;
        colors.push(baseColor[i], colorActive, colorHover, backgroundColor);
      }
    }
    return colors;
  };

  const createColorTexture = () => {
    const colors = getColors();
    const numColors = colors.length;
    colorTexRes = Math.max(2, Math.ceil(Math.sqrt(numColors)));
    const rgba = new Float32Array(colorTexRes ** 2 * 4);
    colors.forEach((color, i) => {
      rgba[i * 4] = color[0]; // r
      rgba[i * 4 + 1] = color[1]; // g
      rgba[i * 4 + 2] = color[2]; // b
      rgba[i * 4 + 3] = color[3]; // a
    });

    return renderer.regl.texture({
      data: rgba,
      shape: [colorTexRes, colorTexRes, 4],
      type: 'float',
    });
  };

  /**
   * Since we're using an external renderer whose canvas' width and height
   * might differ from this instance's width and height, we have to adjust the
   * projection of camera spaces into clip space accordingly.
   *
   * The `widthRatio` is rendererCanvas.width / thisCanvas.width
   * The `heightRatio` is rendererCanvas.height / thisCanvas.height
   */
  const updateProjectionMatrix = (widthRatio, heightRatio) => {
    projection[0] = widthRatio / viewAspectRatio;
    projection[5] = heightRatio;
  };

  const updateViewAspectRatio = () => {
    viewAspectRatio = currentWidth / currentHeight;
    projectionLocal = mat4.fromScaling([], [1 / viewAspectRatio, 1, 1]);
    projection = mat4.fromScaling([], [1 / viewAspectRatio, 1, 1]);
    model = mat4.fromScaling([], [dataAspectRatio, 1, 1]);
  };

  const setDataAspectRatio = (newDataAspectRatio) => {
    if (+newDataAspectRatio <= 0) {
      return;
    }
    dataAspectRatio = newDataAspectRatio;
  };

  const setColors = (getter, setter) => (newColors) => {
    if (!newColors?.length) {
      return;
    }

    const colors = getter();
    const prevColors = [...colors];

    let tmpColors = isMultipleColors(newColors) ? newColors : [newColors];
    tmpColors = tmpColors.map((color) => toRgba(color, true));

    if (colorTex) {
      colorTex.destroy();
    }

    try {
      setter(tmpColors);
      colorTex = createColorTexture();
    } catch (_error) {
      console.error('Invalid colors. Switching back to default colors.');
      setter(prevColors);
      colorTex = createColorTexture();
    }
  };

  const setPointColor = setColors(
    () => pointColor,
    (colors) => {
      pointColor = colors;
    },
  );
  const setPointColorActive = setColors(
    () => pointColorActive,
    (colors) => {
      pointColorActive = colors;
    },
  );
  const setPointColorHover = setColors(
    () => pointColorHover,
    (colors) => {
      pointColorHover = colors;
    },
  );

  const computeDomainView = () => {
    const xyStartPt = getScatterGlPos(-1, -1);
    const xyEndPt = getScatterGlPos(1, 1);

    const xStart = (xyStartPt[0] + 1) / 2;
    const xEnd = (xyEndPt[0] + 1) / 2;
    const yStart = (xyStartPt[1] + 1) / 2;
    const yEnd = (xyEndPt[1] + 1) / 2;

    const xDomainView = [
      xDomainStart + xStart * xDomainSize,
      xDomainStart + xEnd * xDomainSize,
    ];
    const yDomainView = [
      yDomainStart + yStart * yDomainSize,
      yDomainStart + yEnd * yDomainSize,
    ];

    return [xDomainView, yDomainView];
  };

  const updateScales = () => {
    if (!(xScale || yScale)) {
      return;
    }

    const [xDomainView, yDomainView] = computeDomainView();

    if (xScale) {
      xScale.domain(xDomainView);
    }

    if (yScale) {
      yScale.domain(yDomainView);
    }
  };

  const setCurrentHeight = (newCurrentHeight) => {
    currentHeight = Math.max(1, newCurrentHeight);
    canvas.height = Math.floor(currentHeight * window.devicePixelRatio);
    if (yScale) {
      yScale.range([currentHeight, 0]);
      updateScales();
    }
  };

  const setHeight = (newHeight) => {
    if (newHeight === AUTO) {
      height = newHeight;
      canvas.style.height = '100%';
      window.requestAnimationFrame(() => {
        if (canvas) {
          setCurrentHeight(canvas.getBoundingClientRect().height);
        }
      });
      return;
    }

    if (!+newHeight || +newHeight <= 0) {
      return;
    }

    height = +newHeight;
    setCurrentHeight(height);
    canvas.style.height = `${height}px`;
  };

  const computePointSizeMouseDetection = () => {
    computedPointSizeMouseDetection = pointSizeMouseDetection;

    if (pointSizeMouseDetection === AUTO) {
      computedPointSizeMouseDetection = Array.isArray(pointSize)
        ? maxArray(pointSize)
        : pointSize;
    }
  };

  const createSelectionManager = () => {
    if (selectionManager) {
      selectionManager.destroy();
    }
    if (selectionType === LASSO_SELECTION) {
      selectionManager = createLassoManager(canvas, {
        onStart: selectionStart,
        onDraw: selectionExtend,
        onEnd: selectionEnd,
        enableInitiator: selectInitiator,
        initiatorParentElement: selectInitiatorParentElement,
        pointNorm: ([x, y]) => getScatterGlPos(getNdcX(x), getNdcY(y)),
      });
    } else if (selectionType === DIRECTIONAL_SELECTION) {
      selectionManager = createDirManager(canvas, {
        onStart: selectionStart,
        onDraw: selectionExtend,
        onEnd: selectionEnd,
        enableInitiator: selectInitiator,
        initiatorParentElement: selectInitiatorParentElement,
        pointNorm: ([x, y]) => getScatterGlPos(getNdcX(x), getNdcY(y)),
      });
    } else {
      throw new Error('Unknown selection manager type', { selectionType });
    }
  };

  const setPointSize = (newPointSize) => {
    if (isConditionalArray(newPointSize, isPositiveNumber, { minLength: 1 })) {
      pointSize = [...newPointSize];
    }

    if (isStrictlyPositiveNumber(+newPointSize)) {
      pointSize = [+newPointSize];
    }

    minPointScale = MIN_POINT_SIZE / pointSize[0];
    encodingTex = createEncodingTexture();
    computePointSizeMouseDetection();
  };

  const setPointSizeSelected = (newPointSizeSelected) => {
    if (!+newPointSizeSelected || +newPointSizeSelected < 0) {
      return;
    }
    pointSizeSelected = +newPointSizeSelected;
  };

  const setPointOutlineWidth = (newPointOutlineWidth) => {
    if (!+newPointOutlineWidth || +newPointOutlineWidth < 0) {
      return;
    }
    pointOutlineWidth = +newPointOutlineWidth;
  };

  const setCurrentWidth = (newCurrentWidth) => {
    currentWidth = Math.max(1, newCurrentWidth);
    canvas.width = Math.floor(currentWidth * window.devicePixelRatio);
    if (xScale) {
      xScale.range([0, currentWidth]);
      updateScales();
    }
  };

  const setWidth = (newWidth) => {
    if (newWidth === AUTO) {
      width = newWidth;
      canvas.style.width = '100%';
      window.requestAnimationFrame(() => {
        if (canvas) {
          setCurrentWidth(canvas.getBoundingClientRect().width);
        }
      });
      return;
    }

    if (!+newWidth || +newWidth <= 0) {
      return;
    }

    width = +newWidth;
    setCurrentWidth(width);
    canvas.style.width = `${currentWidth}px`;
  };

  const setOpacity = (newOpacity) => {
    if (isConditionalArray(newOpacity, isPositiveNumber, { minLength: 1 })) {
      opacity = [...newOpacity];
    }

    if (isStrictlyPositiveNumber(+newOpacity)) {
      opacity = [+newOpacity];
    }

    encodingTex = createEncodingTexture();
  };

  const getEncodingDataType = (type) => {
    switch (type) {
      case 'valueZ':
        return valueZDataType;

      case 'valueW':
        return valueWDataType;

      default:
        return null;
    }
  };

  const getEncodingValueToIdx = (type, rangeValues) => {
    switch (type) {
      case CONTINUOUS:
        return (value) => Math.round(value * (rangeValues.length - 1));

      default:
        return identity;
    }
  };

  const setColorBy = (type) => {
    colorBy = getEncodingType(type, DEFAULT_COLOR_BY);
  };
  const setOpacityBy = (type) => {
    opacityBy = getEncodingType(type, DEFAULT_OPACITY_BY, {
      allowDensity: true,
    });
  };
  const setSizeBy = (type) => {
    sizeBy = getEncodingType(type, DEFAULT_SIZE_BY);
  };
  const setPointConnectionColorBy = (type) => {
    pointConnectionColorBy = getEncodingType(
      type,
      DEFAULT_POINT_CONNECTION_COLOR_BY,
      { allowSegment: true, allowInherit: true },
    );
  };
  const setPointConnectionOpacityBy = (type) => {
    pointConnectionOpacityBy = getEncodingType(
      type,
      DEFAULT_POINT_CONNECTION_OPACITY_BY,
      { allowSegment: true },
    );
  };
  const setPointConnectionSizeBy = (type) => {
    pointConnectionSizeBy = getEncodingType(
      type,
      DEFAULT_POINT_CONNECTION_SIZE_BY,
      { allowSegment: true },
    );
  };

  const getResolution = () => [canvas.width, canvas.height];
  const getBackgroundImage = () => backgroundImage;
  const getColorTex = () => colorTex;
  const getColorTexRes = () => colorTexRes;
  const getColorTexEps = () => 0.5 / colorTexRes;
  const getDevicePixelRatio = () => window.devicePixelRatio;
  const getNormalPointsIndexBuffer = () => normalPointsIndexBuffer;
  const getSelectedPointsIndexBuffer = () => selectedPointsIndexBuffer;
  const getEncodingTex = () => encodingTex;
  const getEncodingTexRes = () => encodingTexRes;
  const getEncodingTexEps = () => 0.5 / encodingTexRes;
  const getNormalPointSizeExtra = () => 0;
  const getStateTex = () => tmpStateTex || stateTex;
  const getStateTexRes = () => stateTexRes;
  const getStateTexEps = () => 0.5 / stateTexRes;
  const getProjection = () => projection;
  const getView = () => camera.view;
  const getModel = () => model;
  const getModelViewProjection = () =>
    mat4.multiply(pvm, projection, mat4.multiply(pvm, camera.view, model));
  const getPointScale = () => {
    if (camera.scaling[0] > 1) {
      return (
        (Math.asinh(max(1.0, camera.scaling[0])) / Math.asinh(1)) *
        window.devicePixelRatio
      );
    }

    return max(minPointScale, camera.scaling[0]) * window.devicePixelRatio;
  };
  const getNormalNumPoints = () =>
    isPointsFiltered ? filteredPointsSet.size : numPoints;
  const getSelectedNumPoints = () => selectedPoints.length;
  const getPointOpacityMaxBase = () =>
    getSelectedNumPoints() > 0 ? opacityInactiveMax : 1;
  const getPointOpacityScaleBase = () =>
    getSelectedNumPoints() > 0 ? opacityInactiveScale : 1;
  const getIsColoredByZ = () => +(colorBy === 'valueZ');
  const getIsColoredByW = () => +(colorBy === 'valueW');
  const getIsOpacityByZ = () => +(opacityBy === 'valueZ');
  const getIsOpacityByW = () => +(opacityBy === 'valueW');
  const getIsOpacityByDensity = () => +(opacityBy === 'density');
  const getIsSizedByZ = () => +(sizeBy === 'valueZ');
  const getIsSizedByW = () => +(sizeBy === 'valueW');
  const getColorMultiplicator = () => {
    if (colorBy === 'valueZ') {
      return valueZDataType === CONTINUOUS ? pointColor.length - 1 : 1;
    }
    return valueWDataType === CONTINUOUS ? pointColor.length - 1 : 1;
  };
  const getOpacityMultiplicator = () => {
    if (opacityBy === 'valueZ') {
      return valueZDataType === CONTINUOUS ? opacity.length - 1 : 1;
    }
    return valueWDataType === CONTINUOUS ? opacity.length - 1 : 1;
  };
  const getSizeMultiplicator = () => {
    if (sizeBy === 'valueZ') {
      return valueZDataType === CONTINUOUS ? pointSize.length - 1 : 1;
    }
    return valueWDataType === CONTINUOUS ? pointSize.length - 1 : 1;
  };
  const getOpacityDensity = (context) => {
    if (opacityBy !== 'density') {
      return 1;
    }

    // Adopted from the fabulous Ricky Reusser:
    // https://observablehq.com/@rreusser/selecting-the-right-opacity-for-2d-point-clouds
    // Extended with a point-density based approach
    const pointScale = getPointScale(true);
    const p = pointSize[0] * pointScale;

    // Compute the plot's x and y range from the view matrix, though these could come from any source
    const s = (2 / (2 / camera.view[0])) * (2 / (2 / camera.view[5]));

    // Viewport size, in device pixels
    const H = context.viewportHeight;
    const W = context.viewportWidth;

    // Adaptation: Instead of using the global number of points, I am using a
    // density-based approach that takes the points in the view into context
    // when zooming in. This ensure that in sparse areas, points are opaque and
    // in dense areas points are more translucent.
    let alpha =
      ((opacityByDensityFill * W * H) / (numPointsInView * p * p)) * min(1, s);

    // In performanceMode we use squares, otherwise we use circles, which only
    // take up (pi r^2) of the unit square
    alpha *= performanceMode ? 1 : 1 / (0.25 * Math.PI);

    // If the pixels shrink below the minimum permitted size, then we adjust the opacity instead
    // and apply clamping of the point size in the vertex shader. Note that we add 0.5 since we
    // slightly inrease the size of points during rendering to accommodate SDF-style antialiasing.
    const clampedPointDeviceSize = max(MIN_POINT_SIZE, p) + 0.5;

    // We square this since we're concerned with the ratio of *areas*.
    alpha *= (p / clampedPointDeviceSize) ** 2;

    // And finally, we clamp to the range [0, 1]. We should really clamp this to 1 / precision
    // on the low end, depending on the data type of the destination so that we never render *nothing*.
    return min(1, max(0, alpha));
  };

  const updatePoints = renderer.regl({
    framebuffer: () => tmpStateBuffer,

    vert: POINT_UPDATE_VS,
    frag: POINT_UPDATE_FS,

    attributes: {
      position: [-4, 0, 4, 4, 4, -4],
    },

    uniforms: {
      startStateTex: () => prevStateTex,
      endStateTex: () => stateTex,
      t: (_ctx, props) => props.t,
    },

    count: 3,
  });

  const drawPoints = (
    getPointSizeExtra,
    getNumPoints,
    getStateIndexBuffer,
    globalState = COLOR_NORMAL_IDX,
    getPointOpacityMax = getPointOpacityMaxBase,
    getPointOpacityScale = getPointOpacityScaleBase,
  ) =>
    renderer.regl({
      frag: performanceMode ? POINT_SIMPLE_FS : POINT_FS,
      vert: createVertexShader(globalState),

      blend: {
        enable: !performanceMode,
        func: {
          // biome-ignore lint/style/useNamingConvention: Regl specific
          srcRGB: 'src alpha',
          srcAlpha: 'one',
          // biome-ignore lint/style/useNamingConvention: Regl specific
          dstRGB: 'one minus src alpha',
          dstAlpha: 'one minus src alpha',
        },
      },

      depth: { enable: false },

      attributes: {
        stateIndex: {
          buffer: getStateIndexBuffer,
          size: 2,
        },
      },

      uniforms: {
        resolution: getResolution,
        modelViewProjection: getModelViewProjection,
        devicePixelRatio: getDevicePixelRatio,
        pointScale: getPointScale,
        encodingTex: getEncodingTex,
        encodingTexRes: getEncodingTexRes,
        encodingTexEps: getEncodingTexEps,
        pointOpacityMax: getPointOpacityMax,
        pointOpacityScale: getPointOpacityScale,
        pointSizeExtra: getPointSizeExtra,
        globalState,
        colorTex: getColorTex,
        colorTexRes: getColorTexRes,
        colorTexEps: getColorTexEps,
        stateTex: getStateTex,
        stateTexRes: getStateTexRes,
        stateTexEps: getStateTexEps,
        isColoredByZ: getIsColoredByZ,
        isColoredByW: getIsColoredByW,
        isOpacityByZ: getIsOpacityByZ,
        isOpacityByW: getIsOpacityByW,
        isOpacityByDensity: getIsOpacityByDensity,
        isSizedByZ: getIsSizedByZ,
        isSizedByW: getIsSizedByW,
        colorMultiplicator: getColorMultiplicator,
        opacityMultiplicator: getOpacityMultiplicator,
        opacityDensity: getOpacityDensity,
        sizeMultiplicator: getSizeMultiplicator,
        numColorStates: COLOR_NUM_STATES,
      },

      count: getNumPoints,

      primitive: 'points',
    });

  const drawPointBodies = drawPoints(
    getNormalPointSizeExtra,
    getNormalNumPoints,
    getNormalPointsIndexBuffer,
  );

  const drawHoveredPoint = drawPoints(
    getNormalPointSizeExtra,
    () => 1,
    () => hoveredPointIndexBuffer,
    COLOR_HOVER_IDX,
    () => 1,
    () => 1,
  );

  const drawSelectedPointOutlines = drawPoints(
    () => (pointSizeSelected + pointOutlineWidth * 2) * window.devicePixelRatio,
    getSelectedNumPoints,
    getSelectedPointsIndexBuffer,
    COLOR_ACTIVE_IDX,
    () => 1,
    () => 1,
  );

  const drawSelectedPointInnerBorder = drawPoints(
    () => (pointSizeSelected + pointOutlineWidth) * window.devicePixelRatio,
    getSelectedNumPoints,
    getSelectedPointsIndexBuffer,
    COLOR_BG_IDX,
    () => 1,
    () => 1,
  );

  const drawSelectedPointBodies = drawPoints(
    () => pointSizeSelected * window.devicePixelRatio,
    getSelectedNumPoints,
    getSelectedPointsIndexBuffer,
    COLOR_ACTIVE_IDX,
    () => 1,
    () => 1,
  );

  const drawSelectedPoints = () => {
    drawSelectedPointOutlines();
    drawSelectedPointInnerBorder();
    drawSelectedPointBodies();
  };

  const drawBackgroundImage = renderer.regl({
    frag: BG_FS,
    vert: BG_VS,

    attributes: {
      position: [0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0],
    },

    uniforms: {
      modelViewProjection: getModelViewProjection,
      texture: getBackgroundImage,
    },

    count: 6,
  });

  const drawLassoPolygon = renderer.regl({
    vert: `
      precision mediump float;
      uniform mat4 modelViewProjection;
      attribute vec2 position;
      void main () {
        gl_Position = modelViewProjection * vec4(position, 0, 1);
      }`,

    frag: `
      precision mediump float;
      uniform vec4 color;
      void main () {
        gl_FragColor = vec4(color.rgb, 0.2);
      }`,

    depth: { enable: false },

    blend: {
      enable: true,
      func: {
        // biome-ignore lint/style/useNamingConvention: Regl specific
        srcRGB: 'src alpha',
        srcAlpha: 'one',
        // biome-ignore lint/style/useNamingConvention: Regl specific
        dstRGB: 'one minus src alpha',
        dstAlpha: 'one minus src alpha',
      },
    },

    attributes: {
      position: () => selectionPointsCurr,
    },

    uniforms: {
      modelViewProjection: getModelViewProjection,
      color: () => selectColor,
    },

    elements: () =>
      Array.from({ length: selectionPointsCurr.length - 2 }, (_, i) => [
        0,
        i + 1,
        i + 2,
      ]),
  });

  const drawReticle = () => {
    if (!(hoveredPoint >= 0)) {
      return;
    }

    const [x, y] = points[hoveredPoint].slice(0, 2);

    // Homogeneous coordinates of the point
    const v = [x, y, 0, 1];

    // We have to calculate the model-view-projection matrix outside of the
    // shader as we actually don't want the model, view, or projection of the
    // line view space to change such that the reticle is visualized across the
    // entire view container and not within the view of the scatterplot
    mat4.multiply(
      scratch,
      projection,
      mat4.multiply(scratch, camera.view, model),
    );

    vec4.transformMat4(v, v, scratch);

    reticleHLine.setPoints([-1, v[1], 1, v[1]]);
    reticleVLine.setPoints([v[0], 1, v[0], -1]);

    reticleHLine.draw();
    reticleVLine.draw();

    // Draw outer outline
    drawPoints(
      () =>
        (pointSizeSelected + pointOutlineWidth * 2) * window.devicePixelRatio,
      () => 1,
      hoveredPointIndexBuffer,
      COLOR_ACTIVE_IDX,
    )();

    // Draw inner outline
    drawPoints(
      () => (pointSizeSelected + pointOutlineWidth) * window.devicePixelRatio,
      () => 1,
      hoveredPointIndexBuffer,
      COLOR_BG_IDX,
    )();
  };

  const createPointIndex = (numNewPoints) => {
    const index = new Float32Array(numNewPoints * 2);

    let j = 0;
    for (let i = 0; i < numNewPoints; ++i) {
      const texCoord = indexToStateTexCoord(i);
      index[j] = texCoord[0]; // x
      index[j + 1] = texCoord[1]; // y
      j += 2;
    }

    return index;
  };

  const createStateTexture = (newPoints, dataTypes = {}) => {
    const numNewPoints = newPoints.length;
    stateTexRes = Math.max(2, Math.ceil(Math.sqrt(numNewPoints)));
    stateTexEps = 0.5 / stateTexRes;
    const data = new Float32Array(stateTexRes ** 2 * 4);

    let zIsInts = true;
    let wIsInts = true;

    let k = 0;
    let z = 0;
    let w = 0;
    for (let i = 0; i < numNewPoints; ++i) {
      k = i * 4;

      data[k] = newPoints[i][0]; // x
      data[k + 1] = newPoints[i][1]; // y

      z = newPoints[i][2] || 0;
      w = newPoints[i][3] || 0;

      data[k + 2] = z; // z: value 1
      data[k + 3] = w; // w: value 2
      zIsInts &&= Number.isInteger(z);
      wIsInts &&= Number.isInteger(w);
    }

    if (dataTypes.z && VALUE_ZW_DATA_TYPES.includes(dataTypes.z)) {
      valueZDataType = dataTypes.z;
    } else {
      valueZDataType = zIsInts ? CATEGORICAL : CONTINUOUS;
    }

    if (dataTypes.w && VALUE_ZW_DATA_TYPES.includes(dataTypes.w)) {
      valueWDataType = dataTypes.w;
    } else {
      valueWDataType = wIsInts ? CATEGORICAL : CONTINUOUS;
    }

    return renderer.regl.texture({
      data,
      shape: [stateTexRes, stateTexRes, 4],
      type: 'float',
    });
  };

  const cachePoints = (newPoints, dataTypes = {}) => {
    if (!stateTex) {
      return false;
    }

    if (isTransitioning) {
      const tmp = prevStateTex;
      prevStateTex = tmpStateTex;
      tmp.destroy();
    } else {
      prevStateTex = stateTex;
    }

    tmpStateTex = createStateTexture(newPoints, dataTypes);
    tmpStateBuffer = renderer.regl.framebuffer({
      color: tmpStateTex,
      depth: false,
      stencil: false,
    });
    stateTex = undefined;

    return true;
  };

  const hasCachedPoints = () => Boolean(prevStateTex && tmpStateTex);

  const clearCachedPoints = () => {
    if (prevStateTex) {
      prevStateTex.destroy();
      prevStateTex = undefined;
    }

    if (tmpStateTex) {
      tmpStateTex.destroy();
      tmpStateTex = undefined;
    }
  };

  const setPoints = (newPoints, options = {}) =>
    new Promise((resolve) => {
      isPointsDrawn = false;

      const preventFilterReset =
        options?.preventFilterReset && newPoints.length === numPoints;

      numPoints = newPoints.length;
      numPointsInView = numPoints;

      if (stateTex) {
        stateTex.destroy();
      }
      stateTex = createStateTexture(newPoints, {
        z: options.zDataType,
        w: options.wDataType,
      });

      if (!preventFilterReset) {
        normalPointsIndexBuffer({
          usage: 'static',
          type: 'float',
          data: createPointIndex(numPoints),
        });
      }

      createKdbush(options.spatialIndex || newPoints, {
        useWorker: spatialIndexUseWorker,
      })
        .then((newSearchIndex) => {
          spatialIndex = newSearchIndex;
          points = newPoints;

          isPointsDrawn = true;
        })
        .then(resolve);
    });

  const cacheCamera = (newTarget, newDistance) => {
    cameraZoomTargetStart = camera.target;
    cameraZoomTargetEnd = newTarget;
    cameraZoomDistanceStart = camera.distance[0];
    cameraZoomDistanceEnd = newDistance;
  };

  const hasCachedCamera = () =>
    Boolean(
      cameraZoomTargetStart !== undefined &&
        cameraZoomTargetEnd !== undefined &&
        cameraZoomDistanceStart !== undefined &&
        cameraZoomDistanceEnd !== undefined,
    );

  const clearCachedCamera = () => {
    cameraZoomTargetStart = undefined;
    cameraZoomTargetEnd = undefined;
    cameraZoomDistanceStart = undefined;
    cameraZoomDistanceEnd = undefined;
  };

  const getPointConnectionColorIndices = (curvePoints) => {
    const colorEncoding =
      pointConnectionColorBy === 'inherit' ? colorBy : pointConnectionColorBy;

    if (colorEncoding === 'segment') {
      const maxColorIdx = pointConnectionColor.length - 1;
      if (maxColorIdx < 1) {
        return [];
      }
      return curvePoints.reduce((colorIndices, curve, index) => {
        let totalLength = 0;
        const segLengths = [];
        // Compute the total length of the line
        for (let i = 2; i < curve.length; i += 2) {
          const segLength = Math.sqrt(
            (curve[i - 2] - curve[i]) ** 2 + (curve[i - 1] - curve[i + 1]) ** 2,
          );
          segLengths.push(segLength);
          totalLength += segLength;
        }
        colorIndices[index] = [0];
        let cumLength = 0;
        // Assign the color index based on the cumulative length
        for (let i = 0; i < curve.length / 2 - 1; i++) {
          cumLength += segLengths[i];
          // The `4` comes from the fact that we have 4 color states:
          // normal, active, hover, and background
          colorIndices[index].push(
            Math.floor((cumLength / totalLength) * maxColorIdx) * 4,
          );
        }
        // The `4` comes from the fact that we have 4 color states:
        // normal, active, hover, and background
        // colorIndices[index] = rangeMap(
        //   curve.length,
        //   (i) => Math.floor((i / (curve.length - 1)) * maxColorIdx) * 4
        // );
        return colorIndices;
      }, []);
    }

    if (colorEncoding) {
      const encodingIdx = getEncodingIdx(colorEncoding);
      const encodingValueToIdx = getEncodingValueToIdx(
        getEncodingDataType(colorEncoding),
        pointConnectionColorBy === 'inherit'
          ? pointColor
          : pointConnectionColor,
      );
      return pointConnectionMap.reduce(
        (colorIndices, [index, referencePoint]) => {
          // The `4` comes from the fact that we have 4 color states:
          // normal, active, hover, and background
          colorIndices[index] =
            encodingValueToIdx(referencePoint[encodingIdx]) * 4;
          return colorIndices;
        },
        [],
      );
    }

    return Array(pointConnectionMap.length).fill(0);
  };

  const getPointConnectionOpacities = () => {
    const opacityEncoding =
      pointConnectionOpacityBy === 'inherit'
        ? opacityBy
        : pointConnectionOpacityBy;

    if (opacityEncoding === 'segment') {
      const maxOpacityIdx = pointConnectionOpacity.length - 1;
      if (maxOpacityIdx < 1) {
        return [];
      }
      return pointConnectionMap.reduce(
        (opacities, [index, _referencePoint, length]) => {
          opacities[index] = rangeMap(
            length,
            (i) =>
              pointConnectionOpacity[
                Math.floor((i / (length - 1)) * maxOpacityIdx)
              ],
          );
          return opacities;
        },
        [],
      );
    }

    if (opacityEncoding) {
      const encodingIdx = getEncodingIdx(opacityEncoding);
      const encodingRangeMap =
        pointConnectionOpacityBy === 'inherit'
          ? opacity
          : pointConnectionOpacity;
      const encodingValueToIdx = getEncodingValueToIdx(
        getEncodingDataType(opacityEncoding),
        encodingRangeMap,
      );
      return pointConnectionMap.reduce((opacities, [index, referencePoint]) => {
        opacities[index] =
          encodingRangeMap[encodingValueToIdx(referencePoint[encodingIdx])];
        return opacities;
      }, []);
    }

    return undefined;
  };

  const getPointConnectionWidths = () => {
    const sizeEncoding =
      pointConnectionSizeBy === 'inherit' ? sizeBy : pointConnectionSizeBy;

    if (sizeEncoding === 'segment') {
      const maxSizeIdx = pointConnectionSize.length - 1;
      if (maxSizeIdx < 1) {
        return [];
      }
      return pointConnectionMap.reduce(
        (widths, [index, _referencePoint, length]) => {
          widths[index] = rangeMap(
            length,
            (i) =>
              pointConnectionSize[Math.floor((i / (length - 1)) * maxSizeIdx)],
          );
          return widths;
        },
        [],
      );
    }

    if (sizeEncoding) {
      const encodingIdx = getEncodingIdx(sizeEncoding);
      const encodingRangeMap =
        pointConnectionSizeBy === 'inherit' ? pointSize : pointConnectionSize;
      const encodingValueToIdx = getEncodingValueToIdx(
        getEncodingDataType(sizeEncoding),
        encodingRangeMap,
      );
      return pointConnectionMap.reduce((widths, [index, referencePoint]) => {
        widths[index] =
          encodingRangeMap[encodingValueToIdx(referencePoint[encodingIdx])];
        return widths;
      }, []);
    }

    return undefined;
  };

  const setPointConnectionMap = (curvePoints) => {
    pointConnectionMap = [];

    let cumLinePoints = 0;
    Object.keys(curvePoints).forEach((id, index) => {
      pointConnectionMap[id] = [
        index,
        curvePoints[id].reference,
        curvePoints[id].length / 2,
        // Used for offsetting in the buffer manipulations on
        // hovering and selecting
        cumLinePoints,
      ];
      cumLinePoints += curvePoints[id].length / 2;
    });
  };

  const setPointConnections = (newPoints) =>
    new Promise((resolve) => {
      pointConnections.setPoints([]);
      if (newPoints?.length) {
        computingPointConnectionCurves = true;
        createSplineCurve(newPoints, {
          maxIntPointsPerSegment: pointConnectionMaxIntPointsPerSegment,
          tolerance: pointConnectionTolerance,
        }).then((curvePoints) => {
          setPointConnectionMap(curvePoints);
          const curvePointValues = Object.values(curvePoints);
          pointConnections.setPoints(
            curvePointValues.length === 1
              ? curvePointValues[0]
              : curvePointValues,
            {
              colorIndices: getPointConnectionColorIndices(curvePointValues),
              opacities: getPointConnectionOpacities(curvePointValues),
              widths: getPointConnectionWidths(curvePointValues),
            },
          );
          computingPointConnectionCurves = false;
          resolve();
        });
      } else {
        resolve();
      }
    });

  /**
   * Reset the point filter
   * @param {import('./types').ScatterplotMethodOptions['filter']}
   */
  const unfilter = ({ preventEvent = false } = {}) => {
    isPointsFiltered = false;
    filteredPointsSet.clear();
    normalPointsIndexBuffer.subdata(createPointIndex(numPoints));

    return new Promise((resolve) => {
      const finish = () => {
        pubSub.subscribe(
          'draw',
          () => {
            if (!preventEvent) {
              pubSub.publish('unfilter');
            }
            resolve();
          },
          1,
        );
        draw = true;
      };

      // Update point connections
      if (showPointConnections || hasPointConnections(points[0])) {
        setPointConnections(getPoints()).then(() => {
          if (!preventEvent) {
            pubSub.publish('pointConnectionsDraw');
          }
          finish();
        });
      } else {
        finish();
      }
    });
  };

  /**
   * Filter down to a set of points
   * @param {number | number[]} pointIdxs
   * @param {import('./types').ScatterplotMethodOptions['filter']}
   */
  const filter = (pointIdxs, { preventEvent = false } = {}) => {
    const filteredPoints = Array.isArray(pointIdxs) ? pointIdxs : [pointIdxs];

    isPointsFiltered = true;
    filteredPointsSet.clear();

    const filteredPointsBuffer = [];
    const filteredSelectedPoints = [];

    for (let i = filteredPoints.length - 1; i >= 0; i--) {
      const pointIdx = filteredPoints[i];

      if (pointIdx < 0 || pointIdx >= numPoints) {
        // Remove invalid filtered points
        filteredPoints.splice(i, 1);
        continue;
      }

      filteredPointsSet.add(pointIdx);
      filteredPointsBuffer.push.apply(
        filteredPointsBuffer,
        indexToStateTexCoord(pointIdx),
      );

      if (selectedPointsSet.has(pointIdx)) {
        filteredSelectedPoints.push(pointIdx);
      }
    }

    // Update the normal points index buffers
    normalPointsIndexBuffer.subdata(filteredPointsBuffer);

    // Update selection
    select(filteredSelectedPoints, { preventEvent });

    // Unset any potentially hovered point
    if (!filteredPointsSet.has(hoveredPoint)) {
      hover(-1, { preventEvent });
    }

    return new Promise((resolve) => {
      const finish = () => {
        pubSub.subscribe(
          'draw',
          () => {
            if (!preventEvent) {
              pubSub.publish('filter', { points: filteredPoints });
            }
            resolve();
          },
          1,
        );
        draw = true;
      };

      // Update point connections
      if (showPointConnections || hasPointConnections(points[0])) {
        setPointConnections(getPoints()).then(() => {
          if (!preventEvent) {
            pubSub.publish('pointConnectionsDraw');
          }
          // We have to re-apply the selection because the connections might
          // have changed
          select(filteredSelectedPoints, { preventEvent });
          finish();
        });
      } else {
        finish();
      }
    });
  };

  const getPointsInView = () =>
    getPointsInBBox(
      bottomLeftNdc[0],
      bottomLeftNdc[1],
      topRightNdc[0],
      topRightNdc[1],
    );

  const getNumPointsInView = () => {
    numPointsInView = getPointsInView().length;
  };

  const getNumPointsInViewDb = throttleAndDebounce(
    getNumPointsInView,
    opacityByDensityDebounceTime,
  );

  const tweenCamera = (t) => {
    const [xStart, yStart] = cameraZoomTargetStart;
    const [xEnd, yEnd] = cameraZoomTargetEnd;

    const ti = 1.0 - t;

    const targetX = xStart * ti + xEnd * t;
    const targetY = yStart * ti + yEnd * t;
    const distance = cameraZoomDistanceStart * ti + cameraZoomDistanceEnd * t;

    camera.lookAt([targetX, targetY], distance);
  };

  const isTransitioningPoints = () => hasCachedPoints();

  const isTransitioningCamera = () => hasCachedCamera();

  const tween = (duration, easing) => {
    if (!transitionStartTime) {
      transitionStartTime = performance.now();
    }

    const dt = performance.now() - transitionStartTime;
    const t = clip(easing(dt / duration), 0, 1);

    if (isTransitioningPoints()) {
      updatePoints({ t });
    }

    if (isTransitioningCamera()) {
      tweenCamera(t);
    }

    return dt < duration;
  };

  const endTransition = () => {
    isTransitioning = false;
    transitionStartTime = null;
    transitionDuration = undefined;
    transitionEasing = undefined;
    showReticle = preTransitionShowReticle;

    clearCachedPoints();
    clearCachedCamera();

    pubSub.publish('transitionEnd');
  };

  const startTransition = ({ duration = 500, easing = DEFAULT_EASING }) => {
    if (isTransitioning) {
      pubSub.publish('transitionEnd');
    }

    isTransitioning = true;
    transitionStartTime = null;
    transitionDuration = duration;
    transitionEasing = isString(easing)
      ? EASING_FNS[easing] || DEFAULT_EASING
      : easing;
    preTransitionShowReticle = showReticle;
    showReticle = false;

    pubSub.publish('transitionStart');
  };

  /**
   * @param {import('./types').Points} newPoints
   * @param {import('./types').ScatterplotMethodOptions['draw']} options
   * @returns {Promise<void>}
   */
  const publicDraw = (newPoints, options = {}) => {
    if (isDestroyed) {
      return Promise.reject(new Error('The instance was already destroyed'));
    }
    return toArrayOrientedPoints(newPoints).then(
      (newPointsArray) =>
        new Promise((resolve) => {
          if (isDestroyed) {
            // In the special case where the instance was destroyed after
            // scatterplot.draw() was called but before toArrayOrientedPoints()
            // resolved, we will _not_ reject the promise as this would be
            // confusing. Instead we will immediately resolve and return.
            resolve();
            return;
          }

          let pointsCached = false;

          if (
            !options.preventFilterReset ||
            newPointsArray?.length !== numPoints
          ) {
            isPointsFiltered = false;
            filteredPointsSet.clear();
          }

          const drawPointConnections =
            newPointsArray &&
            hasPointConnections(newPointsArray[0]) &&
            (showPointConnections || options.showPointConnectionsOnce);

          const { zDataType, wDataType } = options;

          new Promise((resolveDraw) => {
            if (newPointsArray) {
              if (options.transition) {
                if (newPointsArray.length === numPoints) {
                  pointsCached = cachePoints(newPointsArray, {
                    z: zDataType,
                    w: wDataType,
                  });
                } else {
                  console.warn(
                    'Cannot transition! The number of points between the previous and current draw call must be identical.',
                  );
                }
              }

              setPoints(newPointsArray, {
                zDataType,
                wDataType,
                preventFilterReset: options.preventFilterReset,
                spatialIndex: options.spatialIndex,
              }).then(() => {
                if (options.hover !== undefined) {
                  hover(options.hover, { preventEvent: true });
                }

                if (options.select !== undefined) {
                  select(options.select, { preventEvent: true });
                }

                if (options.filter !== undefined) {
                  filter(options.filter, { preventEvent: true });
                }

                if (drawPointConnections) {
                  setPointConnections(newPointsArray)
                    .then(() => {
                      pubSub.publish('pointConnectionsDraw');
                      draw = true;
                      drawReticleOnce = options.showReticleOnce;
                    })
                    .then(resolve);
                } else {
                  resolveDraw();
                }
              });
            } else {
              resolveDraw();
            }
          }).then(() => {
            if (options.transition && pointsCached) {
              if (drawPointConnections) {
                Promise.all([
                  new Promise((resolveTransition) => {
                    pubSub.subscribe(
                      'transitionEnd',
                      () => {
                        // Point connects cannot be transitioned yet so we hide them during
                        // the transition. Hence, we need to make sure we call `draw()` once
                        // the transition has ended.
                        draw = true;
                        drawReticleOnce = options.showReticleOnce;
                        resolveTransition();
                      },
                      1,
                    );
                  }),
                  new Promise((resolveDraw) => {
                    pubSub.subscribe('pointConnectionsDraw', resolveDraw, 1);
                  }),
                ]).then(resolve);
              } else {
                pubSub.subscribe(
                  'transitionEnd',
                  () => {
                    // Point connects cannot be transitioned yet so we hide them during
                    // the transition. Hence, we need to make sure we call `draw()` once
                    // the transition has ended.
                    draw = true;
                    drawReticleOnce = options.showReticleOnce;
                    resolve();
                  },
                  1,
                );
              }
              startTransition({
                duration: options.transitionDuration,
                easing: options.transitionEasing,
              });
            } else {
              if (drawPointConnections) {
                Promise.all([
                  new Promise((resolveDraw) => {
                    pubSub.subscribe('draw', resolveDraw, 1);
                  }),
                  new Promise((resolveDraw) => {
                    pubSub.subscribe('pointConnectionsDraw', resolveDraw, 1);
                  }),
                ]).then(resolve);
              } else {
                pubSub.subscribe('draw', resolve, 1);
              }
              draw = true;
              drawReticleOnce = options.showReticleOnce;
            }
          });
        }),
    );
  };

  /**
   * Draw line-based annotations.
   * @param {import('./types').Annotation[]} newAnnotations
   * @returns {Promise<void>}
   */
  const drawAnnotations = (newAnnotations) => {
    if (isDestroyed) {
      return Promise.reject(new Error('The instance was already destroyed'));
    }

    isAnnotationsDrawn = false;

    if (newAnnotations.length === 0) {
      return new Promise((resolve) => {
        annotations.clear();
        pubSub.subscribe('draw', resolve, 1);
        isAnnotationsDrawn = true;
        draw = true;
      });
    }

    return new Promise((resolve) => {
      const newPoints = [];
      const newColors = new Map();
      const newColorIndices = [];
      const newWidths = [];

      let maxNewColorIdx = -1;

      const addColorAndWidth = (annotation) => {
        newWidths.push(annotation.lineWidth || annotationLineWidth);

        const color = toRgba(annotation.lineColor || annotationLineColor, true);
        const colorId = `[${color.join(',')}]`;
        if (newColors.has(colorId)) {
          const { idx } = newColors.get(colorId);
          newColorIndices.push(idx);
        } else {
          const idx = ++maxNewColorIdx;
          newColors.set(colorId, { idx, color });
          newColorIndices.push(idx);
        }
      };

      for (const annotation of newAnnotations) {
        if (isHorizontalLine(annotation)) {
          newPoints.push([
            annotation.x1 ?? -annotationHVLineLimit,
            annotation.y,
            annotation.x2 ?? annotationHVLineLimit,
            annotation.y,
          ]);
          addColorAndWidth(annotation);
          continue;
        }

        if (isVerticalLine(annotation)) {
          newPoints.push([
            annotation.x,
            annotation.y1 ?? -annotationHVLineLimit,
            annotation.x,
            annotation.y2 ?? annotationHVLineLimit,
          ]);
          addColorAndWidth(annotation);
          continue;
        }

        if (isRect(annotation)) {
          newPoints.push([
            annotation.x1,
            annotation.y1,
            annotation.x2,
            annotation.y1,
            annotation.x2,
            annotation.y2,
            annotation.x1,
            annotation.y2,
            annotation.x1,
            annotation.y1,
          ]);
          addColorAndWidth(annotation);
          continue;
        }

        if (isDomRect(annotation)) {
          newPoints.push([
            annotation.x,
            annotation.y,
            annotation.x + annotation.width,
            annotation.y,
            annotation.x + annotation.width,
            annotation.y + annotation.height,
            annotation.x,
            annotation.y + annotation.height,
            annotation.x,
            annotation.y,
          ]);
          addColorAndWidth(annotation);
          continue;
        }

        if (isPolygon(annotation)) {
          newPoints.push(annotation.vertices.flatMap(identity));
          addColorAndWidth(annotation);
        }
      }

      annotations.setStyle({
        color: Array.from(newColors.values())
          .sort((a, b) => (a.idx > b.idx ? 1 : -1))
          .map(({ color }) => color),
      });
      annotations.setPoints(
        newPoints.length === 1 ? newPoints.flat() : newPoints,
        {
          colorIndices: newColorIndices,
          widths: newWidths,
        },
      );

      pubSub.subscribe('draw', resolve, 1);
      isAnnotationsDrawn = true;
      draw = true;
    });
  };

  /** @type {<F extends Function>(f: F) => (...args: Parameters<F>) => Promise<ReturnType<F>>} */
  const withDraw =
    (f) =>
    (...args) => {
      const out = f(...args);
      draw = true;
      return new Promise((resolve) => {
        pubSub.subscribe('draw', () => resolve(out), 1);
      });
    };

  /**
   * Get the bounding box of a set of points.
   * @param {number[]} pointIdxs - A list of point indices
   * @returns {import('./types').Rect} The bounding box
   */
  // biome-ignore lint/style/useNamingConvention: BBox stands for BoundingBox
  const getBBoxOfPoints = (pointIdxs) => {
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;

    for (const pointIdx of pointIdxs) {
      const [x, y] = points[pointIdx];
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }

    return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
  };

  /**
   * Zoom to an area specified as a rectangle
   * @param {import('./types').Rect} rect - The rectangle to zoom to in normalized device coordinates
   * @param {import('./types').ScatterplotMethodOptions['zoomToArea']} options
   * @returns {Promise<void>}
   */
  const zoomToArea = (rect, options = {}) =>
    new Promise((resolve) => {
      const target = vec4
        .transformMat4(
          [],
          [rect.x + rect.width / 2, rect.y + rect.height / 2, 0, 0],
          model,
        )
        .slice(0, 2);

      // Vertical field of view
      // The Arc Tangent is based on the original camera position. Otherwise
      // we would have to do `Math.atan(1 / camera.view[5])`
      // biome-ignore lint/style/useNamingConvention: FOV stands for field of view
      const vFOV = 2 * Math.atan(1);

      const aspectRatio = viewAspectRatio / dataAspectRatio;

      const distance =
        rect.height * aspectRatio >= rect.width
          ? // Distance is based on the height of the bounding box
            rect.height / 2 / Math.tan(vFOV / 2)
          : // Distance is based on the width of the bounding box
            rect.width / 2 / Math.tan(vFOV / 2) / aspectRatio;

      if (options.transition) {
        camera.config({ isFixed: true });
        cacheCamera(target, distance);
        pubSub.subscribe(
          'transitionEnd',
          () => {
            resolve();
            camera.config({ isFixed: false });
          },
          1,
        );
        startTransition({
          duration: options.transitionDuration,
          easing: options.transitionEasing,
        });
      } else {
        camera.lookAt(target, distance);
        pubSub.subscribe('draw', resolve, 1);
        draw = true;
      }
    });

  /**
   * Zoom to a set of points
   * @param {number[]} pointIdxs - A list of point indices
   * @param {import('./types').ScatterplotMethodOptions['zoomToPoints']} options
   * @returns {Promise<void>}
   */
  const zoomToPoints = (pointIdxs, options = {}) => {
    if (!isPointsDrawn) {
      return Promise.reject(new Error(ERROR_POINTS_NOT_DRAWN));
    }
    const rect = getBBoxOfPoints(pointIdxs);
    const cX = rect.x + rect.width / 2;
    const cY = rect.y + rect.height / 2;

    const pointSizeNdc = getPointSizeNdc();
    const scale = 1 + (options.padding || 0);

    const w = Math.max(rect.width, pointSizeNdc) * scale;
    const h = Math.max(rect.height, pointSizeNdc) * scale;
    const x = cX - w / 2;
    const y = cY - h / 2;

    return zoomToArea({ x, y, width: w, height: h }, options);
  };

  /**
   * Zoom to a location specified in normalized devide coordinates.
   * @param {number[]} target - The camera target given in normalized device coordinates
   * @param {number} distance - The camera distance
   * @param {import('./types').ScatterplotMethodOptions['zoomToLocation']} options
   * @returns {Promise<void>}
   */
  const zoomToLocation = (target, distance, options = {}) =>
    new Promise((resolve) => {
      if (options.transition) {
        camera.config({ isFixed: true });
        cacheCamera(target, distance);
        pubSub.subscribe(
          'transitionEnd',
          () => {
            resolve();
            camera.config({ isFixed: false });
          },
          1,
        );
        startTransition({
          duration: options.transitionDuration,
          easing: options.transitionEasing,
        });
      } else {
        camera.lookAt(target, distance);
        pubSub.subscribe('draw', resolve, 1);
        draw = true;
      }
    });

  /**
   * Zoom to the origin
   * @param {import('./types').ScatterplotMethodOptions['zoomToLocation']} options
   * @returns {Promise<void>}
   */
  const zoomToOrigin = (options = {}) => zoomToLocation([0, 0], 1, options);

  /**
   * Get the screen position of a point
   * @param {number} pointIdx - Point index
   * @returns {[number, number] | undefined}
   */
  const getScreenPosition = (pointIdx) => {
    if (!isPointsDrawn) {
      throw new Error(ERROR_POINTS_NOT_DRAWN);
    }

    const point = points[pointIdx];

    if (!point) {
      return undefined;
    }

    // Homogeneous coordinates of the point
    const v = [point[0], point[1], 0, 1];

    // Convert to clip space
    mat4.multiply(
      scratch,
      projectionLocal,
      mat4.multiply(scratch, camera.view, model),
    );

    vec4.transformMat4(v, v, scratch);

    // Finally, we convert to the screen space
    const x = (currentWidth * (v[0] + 1)) / 2;
    const y = currentHeight * (0.5 - v[1] / 2);

    return [x, y];
  };

  const updatePointConnectionStyle = () => {
    pointConnections.setStyle({
      color: getColors(
        pointConnectionColor,
        pointConnectionColorActive,
        pointConnectionColorHover,
      ),
      opacity:
        pointConnectionOpacity === null ? null : pointConnectionOpacity[0],
      width: pointConnectionSize[0],
    });
  };

  const updateSelectInitiatorStyle = () => {
    const v = Math.round(backgroundColorBrightness) > 0.5 ? 0 : 255;
    selectionManager.initiator.style.border = `1px dashed rgba(${v}, ${v}, ${v}, 0.33)`;
    selectionManager.initiator.style.background = `rgba(${v}, ${v}, ${v}, 0.1)`;
  };

  const updateSelectLongPressIndicatorStyle = () => {
    const v = Math.round(backgroundColorBrightness) > 0.5 ? 0 : 255;

    selectionManager.longPressIndicator.style.color = `rgb(${v}, ${v}, ${v})`;
    selectionManager.longPressIndicator.dataset.color = `rgb(${v}, ${v}, ${v})`;

    const rgb = selectColor.map((c) => Math.round(c * 255));
    selectionManager.longPressIndicator.dataset.activeColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  };

  const setBackgroundColor = (newBackgroundColor) => {
    if (!newBackgroundColor) {
      return;
    }

    backgroundColor = toRgba(newBackgroundColor, true);
    backgroundColorBrightness = rgbBrightness(backgroundColor);
    updateSelectInitiatorStyle();
    updateSelectLongPressIndicatorStyle();
  };

  const setBackgroundImage = (newBackgroundImage) => {
    if (!newBackgroundImage) {
      backgroundImage = null;
    } else if (isString(newBackgroundImage)) {
      createTextureFromUrl(renderer.regl, newBackgroundImage)
        .then((texture) => {
          backgroundImage = texture;
          draw = true;
          pubSub.publish('backgroundImageReady');
        })
        .catch(() => {
          console.error(`Count not create texture from ${newBackgroundImage}`);
          backgroundImage = null;
        });
    } else if (newBackgroundImage._reglType === 'texture2d') {
      backgroundImage = newBackgroundImage;
    } else {
      backgroundImage = null;
    }
  };

  const setCameraDistance = (distance) => {
    if (distance > 0) {
      camera.lookAt(camera.target, distance, camera.rotation);
    }
  };

  const setCameraRotation = (rotation) => {
    if (rotation !== null) {
      camera.lookAt(camera.target, camera.distance[0], rotation);
    }
  };

  const setCameraTarget = (target) => {
    if (target) {
      camera.lookAt(target, camera.distance[0], camera.rotation);
    }
  };

  const setCameraView = (view) => {
    if (view) {
      camera.setView(view);
    }
  };

  const setSelectColor = (newSelectColor) => {
    if (!newSelectColor) {
      return;
    }

    selectColor = toRgba(newSelectColor, true);

    selectionOutline.setStyle({ color: selectColor });

    const rgb = selectColor.map((c) => Math.round(c * 255));
    selectionManager.longPressIndicator.dataset.activeColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  };

  const setSelectLineWidth = (newSelectLineWidth) => {
    if (Number.isNaN(+newSelectLineWidth) || +newSelectLineWidth < 1) {
      return;
    }

    selectLineWidth = +newSelectLineWidth;

    selectionOutline.setStyle({ width: selectLineWidth });
  };

  const setSelectMinDelay = (newSelectMinDelay) => {
    if (!+newSelectMinDelay) {
      return;
    }

    selectMinDelay = +newSelectMinDelay;

    selectionManager.set({
      minDelay: selectMinDelay,
    });
  };

  const setSelectMinDist = (newSelectMinDist) => {
    if (!+newSelectMinDist) {
      return;
    }

    selectMinDist = +newSelectMinDist;

    selectionManager.set({
      minDist: selectMinDist,
    });
  };

  const setSelectClearEvent = (newSelectClearEvent) => {
    selectClearEvent = limit(
      SELECT_CLEAR_EVENTS,
      selectClearEvent,
    )(newSelectClearEvent);
  };

  const setSelectInitiator = (newSelectInitiator) => {
    selectInitiator = Boolean(newSelectInitiator);

    selectionManager.set({
      enableInitiator: selectInitiator,
    });
  };

  const setSelectInitiatorParentElement = (newSelectInitiatorParentElement) => {
    selectInitiatorParentElement = newSelectInitiatorParentElement;

    selectionManager.set({
      startInitiatorParentElement: selectInitiatorParentElement,
    });
  };

  const setSelectOnLongPress = (newSelectOnLongPress) => {
    selectOnLongPress = Boolean(newSelectOnLongPress);
  };

  const setSelectLongPressTime = (newSelectOnLongPressTime) => {
    selectLongPressTime = Number(newSelectOnLongPressTime);
  };

  const setSelectLongPressAfterEffectTime = (newTime) => {
    selectLongPressAfterEffectTime = Number(newTime);
  };

  const setSelectLongPressEffectDelay = (newDelay) => {
    selectLongPressEffectDelay = Number(newDelay);
  };

  const setSelectLongPressRevertEffectTime = (newTime) => {
    selectLongPressRevertEffectTime = Number(newTime);
  };

  const setKeyMap = (newKeyMap) => {
    keyMap = Object.entries(newKeyMap).reduce((map, [key, value]) => {
      if (KEYS.includes(key) && KEY_ACTIONS.includes(value)) {
        map[key] = value;
      }
      return map;
    }, {});
    keyActionMap = flipObj(keyMap);

    if (keyActionMap[KEY_ACTION_ROTATE]) {
      camera.config({
        isRotate: true,
        mouseDownMoveModKey: keyActionMap[KEY_ACTION_ROTATE],
      });
    } else {
      camera.config({
        isRotate: false,
      });
    }
  };

  const setMouseMode = (newMouseMode) => {
    const prevMode = mouseMode;
    mouseMode = limit(MOUSE_MODES, MOUSE_MODE_PANZOOM)(newMouseMode);

    camera.config({
      defaultMouseDownMoveAction:
        mouseMode === MOUSE_MODE_ROTATE ? 'rotate' : 'pan',
    });

    if (MOUSE_SELECT_MODES.includes(mouseMode) && mouseMode !== prevMode) {
      if (mouseMode === MOUSE_MODE_SELECT_DIRECTIONAL) {
        setSelectionManager(DIRECTIONAL_SELECTION);
      }
      if (mouseMode === MOUSE_MODE_SELECT_LASSO) {
        setSelectionManager(LASSO_SELECTION);
      }
    }
  };

  const setShowReticle = (newShowReticle) => {
    if (newShowReticle === null) {
      return;
    }

    showReticle = newShowReticle;
  };

  const setReticleColor = (newReticleColor) => {
    if (!newReticleColor) {
      return;
    }

    reticleColor = toRgba(newReticleColor, true);

    reticleHLine.setStyle({ color: reticleColor });
    reticleVLine.setStyle({ color: reticleColor });
  };

  // biome-ignore lint/style/useNamingConvention: XScale are two words
  const setXScale = (newXScale) => {
    if (!newXScale) {
      return;
    }

    xScale = newXScale;
    xDomainStart = newXScale.domain()[0];
    xDomainSize = newXScale ? newXScale.domain()[1] - newXScale.domain()[0] : 0;
    xScale.range([0, currentWidth]);
    updateScales();
  };

  // biome-ignore lint/style/useNamingConvention: YScale are two words
  const setYScale = (newYScale) => {
    if (!newYScale) {
      return;
    }

    yScale = newYScale;
    yDomainStart = yScale.domain()[0];
    yDomainSize = yScale ? yScale.domain()[1] - yScale.domain()[0] : 0;
    yScale.range([currentHeight, 0]);
    updateScales();
  };

  const setDeselectOnDblClick = (newDeselectOnDblClick) => {
    deselectOnDblClick = !!newDeselectOnDblClick;
  };

  const setDeselectOnEscape = (newDeselectOnEscape) => {
    deselectOnEscape = !!newDeselectOnEscape;
  };

  const setShowPointConnections = (newShowPointConnections) => {
    showPointConnections = !!newShowPointConnections;
    if (showPointConnections) {
      if (isPointsDrawn && hasPointConnections(points[0])) {
        setPointConnections(getPoints()).then(() => {
          pubSub.publish('pointConnectionsDraw');
          draw = true;
        });
      }
    } else {
      setPointConnections();
    }
  };

  const setPointConnectionColors = (setter, getInheritance) => (newColors) => {
    if (newColors === 'inherit') {
      setter([...getInheritance()]);
    } else {
      const tmpColors = isMultipleColors(newColors) ? newColors : [newColors];
      setter(tmpColors.map((color) => toRgba(color, true)));
    }
    updatePointConnectionStyle();
  };

  const setPointConnectionColor = setPointConnectionColors(
    (newColors) => {
      pointConnectionColor = newColors;
    },
    () => pointColor,
  );

  const setPointConnectionColorActive = setPointConnectionColors(
    (newColors) => {
      pointConnectionColorActive = newColors;
    },
    () => pointColorActive,
  );

  const setPointConnectionColorHover = setPointConnectionColors(
    (newColors) => {
      pointConnectionColorHover = newColors;
    },
    () => pointColorHover,
  );

  const setPointConnectionOpacity = (newOpacity) => {
    if (isConditionalArray(newOpacity, isPositiveNumber, { minLength: 1 })) {
      pointConnectionOpacity = [...newOpacity];
    }

    if (isStrictlyPositiveNumber(+newOpacity)) {
      pointConnectionOpacity = [+newOpacity];
    }

    pointConnectionColor = pointConnectionColor.map((color) => {
      color[3] = Number.isNaN(+pointConnectionOpacity[0])
        ? color[3]
        : +pointConnectionOpacity[0];
      return color;
    });

    updatePointConnectionStyle();
  };

  const setPointConnectionOpacityActive = (newOpacity) => {
    if (!Number.isNaN(+newOpacity) && +newOpacity) {
      pointConnectionOpacityActive = +newOpacity;
    }
  };

  const setPointConnectionSize = (newPointConnectionSize) => {
    if (
      isConditionalArray(newPointConnectionSize, isPositiveNumber, {
        minLength: 1,
      })
    ) {
      pointConnectionSize = [...newPointConnectionSize];
    }

    if (isStrictlyPositiveNumber(+newPointConnectionSize)) {
      pointConnectionSize = [+newPointConnectionSize];
    }

    updatePointConnectionStyle();
  };

  const setPointConnectionSizeActive = (newPointConnectionSizeActive) => {
    if (
      !Number.isNaN(+newPointConnectionSizeActive) &&
      +newPointConnectionSizeActive
    ) {
      pointConnectionSizeActive = Math.max(0, newPointConnectionSizeActive);
    }
  };

  const setPointConnectionMaxIntPointsPerSegment = (
    newPointConnectionMaxIntPointsPerSegment,
  ) => {
    pointConnectionMaxIntPointsPerSegment = Math.max(
      0,
      newPointConnectionMaxIntPointsPerSegment,
    );
  };

  const setPointConnectionTolerance = (newPointConnectionTolerance) => {
    pointConnectionTolerance = Math.max(0, newPointConnectionTolerance);
  };

  const setPointSizeMouseDetection = (newPointSizeMouseDetection) => {
    pointSizeMouseDetection = newPointSizeMouseDetection;
    computePointSizeMouseDetection();
  };

  const setOpacityByDensityFill = (newOpacityByDensityFill) => {
    opacityByDensityFill = +newOpacityByDensityFill;
  };

  const setOpacityInactiveMax = (newOpacityInactiveMax) => {
    opacityInactiveMax = +newOpacityInactiveMax;
  };

  const setOpacityInactiveScale = (newOpacityInactiveScale) => {
    opacityInactiveScale = +newOpacityInactiveScale;
  };

  const setAnnotationLineColor = (newAnnotationLineColor) => {
    annotationLineColor = toRgba(newAnnotationLineColor);
  };

  const setAnnotationLineWidth = (newAnnotationLineWidth) => {
    annotationLineWidth = +newAnnotationLineWidth;
  };

  // biome-ignore lint/style/useNamingConvention: HVLine stands for horizontal vertical line
  const setAnnotationHVLineLimit = (newAnnotationHVLineLimit) => {
    annotationHVLineLimit = +newAnnotationHVLineLimit;
  };

  /**
   * @param {"lasso" | "directional"} type
   */
  const setSelectionManager = (newSelectionType) => {
    selectionType = newSelectionType;
    createSelectionManager();
  };

  const setGamma = (newGamma) => {
    renderer.gamma = newGamma;
  };

  /** @type {<Key extends keyof import('./types').Properties>(property: Key) => import('./types').Properties[Key] } */
  const get = (property) => {
    checkDeprecations({ property: true });

    if (property === 'aspectRatio') {
      return dataAspectRatio;
    }

    if (property === 'background') {
      return backgroundColor;
    }

    if (property === 'backgroundColor') {
      return backgroundColor;
    }

    if (property === 'backgroundImage') {
      return backgroundImage;
    }

    if (property === 'camera') {
      return camera;
    }

    if (property === 'cameraTarget') {
      return camera.target;
    }

    if (property === 'cameraDistance') {
      return camera.distance[0];
    }

    if (property === 'cameraRotation') {
      return camera.rotation;
    }

    if (property === 'cameraView') {
      return camera.view;
    }

    if (property === 'canvas') {
      return canvas;
    }

    if (property === 'colorBy') {
      return colorBy;
    }

    if (property === 'sizeBy') {
      return sizeBy;
    }

    if (property === 'deselectOnDblClick') {
      return deselectOnDblClick;
    }

    if (property === 'deselectOnEscape') {
      return deselectOnEscape;
    }

    if (property === 'height') {
      return height;
    }

    if (property === 'selectColor') {
      return selectColor;
    }

    if (property === 'selectLineWidth') {
      return selectLineWidth;
    }

    if (property === 'selectMinDelay') {
      return selectMinDelay;
    }

    if (property === 'selectMinDist') {
      return selectMinDist;
    }

    if (property === 'selectClearEvent') {
      return selectClearEvent;
    }

    if (property === 'selectInitiator') {
      return selectInitiator;
    }

    if (property === 'selectInitiatorElement') {
      return selectionManager.initiator;
    }

    if (property === 'selectInitiatorParentElement') {
      return selectInitiatorParentElement;
    }
    if (property === 'keyMap') {
      return { ...keyMap };
    }

    if (property === 'mouseMode') {
      return mouseMode;
    }

    if (property === 'opacity') {
      return opacity.length === 1 ? opacity[0] : opacity;
    }
    if (property === 'opacityBy') {
      return opacityBy;
    }

    if (property === 'opacityByDensityFill') {
      return opacityByDensityFill;
    }

    if (property === 'opacityByDensityDebounceTime') {
      return opacityByDensityDebounceTime;
    }

    if (property === 'opacityInactiveMax') {
      return opacityInactiveMax;
    }

    if (property === 'opacityInactiveScale') {
      return opacityInactiveScale;
    }

    if (property === 'points') {
      return points;
    }

    if (property === 'hoveredPoint') {
      return hoveredPoint;
    }

    if (property === 'selectedPoints') {
      return [...selectedPoints];
    }

    if (property === 'filteredPoints') {
      return isPointsFiltered
        ? Array.from(filteredPointsSet)
        : Array.from({ length: points.length }, (_, i) => i);
    }

    if (property === 'pointsInView') {
      return getPointsInView();
    }

    if (property === 'pointColor') {
      return pointColor.length === 1 ? pointColor[0] : pointColor;
    }

    if (property === 'pointColorActive') {
      return pointColorActive.length === 1
        ? pointColorActive[0]
        : pointColorActive;
    }

    if (property === 'pointColorHover') {
      return pointColorHover.length === 1
        ? pointColorHover[0]
        : pointColorHover;
    }

    if (property === 'pointOutlineWidth') {
      return pointOutlineWidth;
    }

    if (property === 'pointSize') {
      return pointSize.length === 1 ? pointSize[0] : pointSize;
    }

    if (property === 'pointSizeSelected') {
      return pointSizeSelected;
    }

    if (property === 'pointSizeMouseDetection') {
      return pointSizeMouseDetection;
    }

    if (property === 'showPointConnections') {
      return showPointConnections;
    }

    if (property === 'pointConnectionColor') {
      return pointConnectionColor.length === 1
        ? pointConnectionColor[0]
        : pointConnectionColor;
    }

    if (property === 'pointConnectionColorActive') {
      return pointConnectionColorActive.length === 1
        ? pointConnectionColorActive[0]
        : pointConnectionColorActive;
    }

    if (property === 'pointConnectionColorHover') {
      return pointConnectionColorHover.length === 1
        ? pointConnectionColorHover[0]
        : pointConnectionColorHover;
    }

    if (property === 'pointConnectionColorBy') {
      return pointConnectionColorBy;
    }

    if (property === 'pointConnectionOpacity') {
      return pointConnectionOpacity.length === 1
        ? pointConnectionOpacity[0]
        : pointConnectionOpacity;
    }

    if (property === 'pointConnectionOpacityBy') {
      return pointConnectionOpacityBy;
    }

    if (property === 'pointConnectionOpacityActive') {
      return pointConnectionOpacityActive;
    }

    if (property === 'pointConnectionSize') {
      return pointConnectionSize.length === 1
        ? pointConnectionSize[0]
        : pointConnectionSize;
    }

    if (property === 'pointConnectionSizeActive') {
      return pointConnectionSizeActive;
    }

    if (property === 'pointConnectionSizeBy') {
      return pointConnectionSizeBy;
    }

    if (property === 'pointConnectionMaxIntPointsPerSegment') {
      return pointConnectionMaxIntPointsPerSegment;
    }

    if (property === 'pointConnectionTolerance') {
      return pointConnectionTolerance;
    }

    if (property === 'reticleColor') {
      return reticleColor;
    }

    if (property === 'regl') {
      return renderer.regl;
    }

    if (property === 'showReticle') {
      return showReticle;
    }

    if (property === 'version') {
      return version;
    }

    if (property === 'width') {
      return width;
    }

    if (property === 'xScale') {
      return xScale;
    }

    if (property === 'yScale') {
      return yScale;
    }

    if (property === 'performanceMode') {
      return performanceMode;
    }

    if (property === 'gamma') {
      return renderer.gamma;
    }

    if (property === 'renderer') {
      return renderer;
    }

    if (property === 'isDestroyed') {
      return isDestroyed;
    }

    if (property === 'isPointsDrawn') {
      return isPointsDrawn;
    }

    if (property === 'isPointsFiltered') {
      return isPointsFiltered;
    }

    if (property === 'isAnnotationsDrawn') {
      return isAnnotationsDrawn;
    }

    if (property === 'zDataType') {
      return valueZDataType;
    }

    if (property === 'wDataType') {
      return valueWDataType;
    }

    if (property === 'spatialIndex') {
      return spatialIndex?.data;
    }

    if (property === 'annotationLineColor') {
      return annotationLineColor;
    }

    if (property === 'annotationLineWidth') {
      return annotationLineWidth;
    }

    if (property === 'annotationHVLineLimit') {
      return annotationHVLineLimit;
    }

    if (property === 'selectionType') {
      return selectionType;
    }

    return undefined;
  };

  /** @type {(properties: Partial<import('./types').Settable>) => void} */
  const set = (properties = {}) => {
    checkDeprecations(properties);

    if (
      properties.backgroundColor !== undefined ||
      properties.background !== undefined
    ) {
      setBackgroundColor(properties.backgroundColor || properties.background);
    }

    if (properties.backgroundImage !== undefined) {
      setBackgroundImage(properties.backgroundImage);
    }

    if (properties.cameraTarget !== undefined) {
      setCameraTarget(properties.cameraTarget);
    }

    if (properties.cameraDistance !== undefined) {
      setCameraDistance(properties.cameraDistance);
    }

    if (properties.cameraRotation !== undefined) {
      setCameraRotation(properties.cameraRotation);
    }

    if (properties.cameraView !== undefined) {
      setCameraView(properties.cameraView);
    }

    if (properties.colorBy !== undefined) {
      setColorBy(properties.colorBy);
    }

    if (properties.pointColor !== undefined) {
      setPointColor(properties.pointColor);
    }

    if (properties.pointColorActive !== undefined) {
      setPointColorActive(properties.pointColorActive);
    }

    if (properties.pointColorHover !== undefined) {
      setPointColorHover(properties.pointColorHover);
    }

    if (properties.pointSize !== undefined) {
      setPointSize(properties.pointSize);
    }

    if (properties.pointSizeSelected !== undefined) {
      setPointSizeSelected(properties.pointSizeSelected);
    }

    if (properties.pointSizeMouseDetection !== undefined) {
      setPointSizeMouseDetection(properties.pointSizeMouseDetection);
    }

    if (properties.sizeBy !== undefined) {
      setSizeBy(properties.sizeBy);
    }

    if (properties.opacity !== undefined) {
      setOpacity(properties.opacity);
    }

    if (properties.showPointConnections !== undefined) {
      setShowPointConnections(properties.showPointConnections);
    }

    if (properties.pointConnectionColor !== undefined) {
      setPointConnectionColor(properties.pointConnectionColor);
    }

    if (properties.pointConnectionColorActive !== undefined) {
      setPointConnectionColorActive(properties.pointConnectionColorActive);
    }

    if (properties.pointConnectionColorHover !== undefined) {
      setPointConnectionColorHover(properties.pointConnectionColorHover);
    }

    if (properties.pointConnectionColorBy !== undefined) {
      setPointConnectionColorBy(properties.pointConnectionColorBy);
    }

    if (properties.pointConnectionOpacityBy !== undefined) {
      setPointConnectionOpacityBy(properties.pointConnectionOpacityBy);
    }

    if (properties.pointConnectionOpacity !== undefined) {
      setPointConnectionOpacity(properties.pointConnectionOpacity);
    }

    if (properties.pointConnectionOpacityActive !== undefined) {
      setPointConnectionOpacityActive(properties.pointConnectionOpacityActive);
    }

    if (properties.pointConnectionSize !== undefined) {
      setPointConnectionSize(properties.pointConnectionSize);
    }

    if (properties.pointConnectionSizeActive !== undefined) {
      setPointConnectionSizeActive(properties.pointConnectionSizeActive);
    }

    if (properties.pointConnectionSizeBy !== undefined) {
      setPointConnectionSizeBy(properties.pointConnectionSizeBy);
    }

    if (properties.pointConnectionMaxIntPointsPerSegment !== undefined) {
      setPointConnectionMaxIntPointsPerSegment(
        properties.pointConnectionMaxIntPointsPerSegment,
      );
    }

    if (properties.pointConnectionTolerance !== undefined) {
      setPointConnectionTolerance(properties.pointConnectionTolerance);
    }

    if (properties.opacityBy !== undefined) {
      setOpacityBy(properties.opacityBy);
    }

    if (properties.selectColor !== undefined) {
      setSelectColor(properties.selectColor);
    }

    if (properties.selectLineWidth !== undefined) {
      setSelectLineWidth(properties.selectLineWidth);
    }

    if (properties.selectMinDelay !== undefined) {
      setSelectMinDelay(properties.selectMinDelay);
    }

    if (properties.selectMinDist !== undefined) {
      setSelectMinDist(properties.selectMinDist);
    }

    if (properties.selectClearEvent !== undefined) {
      setSelectClearEvent(properties.selectClearEvent);
    }

    if (properties.selectInitiator !== undefined) {
      setSelectInitiator(properties.selectInitiator);
    }

    if (properties.selectInitiatorParentElement !== undefined) {
      setSelectInitiatorParentElement(properties.selectInitiatorParentElement);
    }

    if (properties.selectOnLongPress !== undefined) {
      setSelectOnLongPress(properties.selectOnLongPress);
    }

    if (properties.selectLongPressTime !== undefined) {
      setSelectLongPressTime(properties.selectLongPressTime);
    }

    if (properties.selectLongPressAfterEffectTime !== undefined) {
      setSelectLongPressAfterEffectTime(
        properties.selectLongPressAfterEffectTime,
      );
    }

    if (properties.selectLongPressEffectDelay !== undefined) {
      setSelectLongPressEffectDelay(properties.selectLongPressEffectDelay);
    }

    if (properties.selectLongPressRevertEffectTime !== undefined) {
      setSelectLongPressRevertEffectTime(
        properties.selectLongPressRevertEffectTime,
      );
    }

    if (properties.keyMap !== undefined) {
      setKeyMap(properties.keyMap);
    }

    if (properties.mouseMode !== undefined) {
      setMouseMode(properties.mouseMode);
    }

    if (properties.showReticle !== undefined) {
      setShowReticle(properties.showReticle);
    }

    if (properties.reticleColor !== undefined) {
      setReticleColor(properties.reticleColor);
    }

    if (properties.pointOutlineWidth !== undefined) {
      setPointOutlineWidth(properties.pointOutlineWidth);
    }

    if (properties.height !== undefined) {
      setHeight(properties.height);
    }

    if (properties.width !== undefined) {
      setWidth(properties.width);
    }

    if (properties.aspectRatio !== undefined) {
      setDataAspectRatio(properties.aspectRatio);
    }

    if (properties.xScale !== undefined) {
      setXScale(properties.xScale);
    }

    if (properties.yScale !== undefined) {
      setYScale(properties.yScale);
    }

    if (properties.deselectOnDblClick !== undefined) {
      setDeselectOnDblClick(properties.deselectOnDblClick);
    }

    if (properties.deselectOnEscape !== undefined) {
      setDeselectOnEscape(properties.deselectOnEscape);
    }

    if (properties.opacityByDensityFill !== undefined) {
      setOpacityByDensityFill(properties.opacityByDensityFill);
    }

    if (properties.opacityInactiveMax !== undefined) {
      setOpacityInactiveMax(properties.opacityInactiveMax);
    }

    if (properties.opacityInactiveScale !== undefined) {
      setOpacityInactiveScale(properties.opacityInactiveScale);
    }

    if (properties.gamma !== undefined) {
      setGamma(properties.gamma);
    }

    if (properties.annotationLineColor !== undefined) {
      setAnnotationLineColor(properties.annotationLineColor);
    }

    if (properties.annotationLineWidth !== undefined) {
      setAnnotationLineWidth(properties.annotationLineWidth);
    }

    if (properties.annotationHVLineLimit !== undefined) {
      setAnnotationHVLineLimit(properties.annotationHVLineLimit);
    }

    if (properties.selectionType !== undefined) {
      setSelectionManager(properties.selectionType);
    }

    // setWidth and setHeight can be async when width or height are set to
    // 'auto'. And since draw() would have anyway been async we can just make
    // all calls async.
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        if (!canvas) {
          // Instance was destroyed in between
          return;
        }
        updateViewAspectRatio();
        camera.refresh();
        renderer.refresh();
        draw = true;
        resolve();
      });
    });
  };

  /**
   * @param {number[]} cameraView
   * @param {import('./types').ScatterplotMethodOptions['preventEvent']} options
   */
  const view = (cameraView, { preventEvent = false } = {}) => {
    setCameraView(cameraView);
    draw = true;
    preventEventView = preventEvent;
  };

  const initCamera = () => {
    if (!camera) {
      camera = createDom2dCamera(canvas, {
        isPanInverted: [false, true],
        defaultMouseDownMoveAction:
          mouseMode === MOUSE_MODE_ROTATE ? 'rotate' : 'pan',
      });
    }

    if (initialProperties.cameraView) {
      camera.setView(mat4.clone(initialProperties.cameraView));
    } else if (
      initialProperties.cameraTarget ||
      initialProperties.cameraDistance ||
      initialProperties.cameraRotation
    ) {
      camera.lookAt(
        [...(initialProperties.cameraTarget || DEFAULT_TARGET)],
        initialProperties.cameraDistance || DEFAULT_DISTANCE,
        initialProperties.cameraRotation || DEFAULT_ROTATION,
      );
    } else {
      camera.setView(mat4.clone(DEFAULT_VIEW));
    }

    topRightNdc = getScatterGlPos(1, 1);
    bottomLeftNdc = getScatterGlPos(-1, -1);
  };

  /**
   * @param {import('./types').ScatterplotMethodOptions['preventEvent']} options
   */
  const reset = ({ preventEvent = false } = {}) => {
    initCamera();
    updateScales();

    if (preventEvent) {
      return;
    }

    pubSub.publish('view', {
      view: camera.view,
      camera,
      xScale,
      yScale,
    });
  };

  const keyUpHandler = ({ key }) => {
    switch (key) {
      case 'Escape': {
        if (deselectOnEscape) {
          deselect();
        }
        break;
      }
      default:
      // Nothing
    }
  };

  const mouseEnterCanvasHandler = () => {
    isMouseInCanvas = true;
    isMouseOverCanvasChecked = true;
  };

  const mouseLeaveCanvasHandler = () => {
    hover();
    isMouseInCanvas = false;
    isMouseOverCanvasChecked = true;
    draw = true;
  };

  const wheelHandler = () => {
    draw = true;
  };

  /** @type {() => void} */
  const clearPoints = () => {
    setPoints([]);
    pointConnections.clear();
  };

  /** @type {() => void} */
  const clearPointConnections = () => {
    pointConnections.clear();
  };

  /** @type {() => void} */
  const clearAnnotations = () => {
    drawAnnotations([]);
  };

  /** @type {() => void} */
  const clear = () => {
    clearPoints();
    clearAnnotations();
  };

  const resizeHandler = () => {
    camera.refresh();
    const autoWidth = width === AUTO;
    const autoHeight = height === AUTO;
    if (autoWidth || autoHeight) {
      const { width: newWidth, height: newHeight } =
        canvas.getBoundingClientRect();

      if (autoWidth) {
        setCurrentWidth(newWidth);
      }

      if (autoHeight) {
        setCurrentHeight(newHeight);
      }

      updateViewAspectRatio();
      draw = true;
    }
  };

  /** @type {() => ImageData} */
  const exportFn = () => {
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  };

  const init = () => {
    updateViewAspectRatio();
    initCamera();
    updateScales();

    selectionOutline = createLine(renderer.regl, {
      color: selectColor,
      width: selectLineWidth,
      is2d: true,
    });
    pointConnections = createLine(renderer.regl, {
      color: getColors(
        pointConnectionColor,
        pointConnectionColorActive,
        pointConnectionColorHover,
      ),
      opacity:
        pointConnectionOpacity === null ? null : pointConnectionOpacity[0],
      width: pointConnectionSize[0],
      widthActive: pointConnectionSizeActive,
      is2d: true,
    });
    reticleHLine = createLine(renderer.regl, {
      color: reticleColor,
      width: 1,
      is2d: true,
    });
    reticleVLine = createLine(renderer.regl, {
      color: reticleColor,
      width: 1,
      is2d: true,
    });
    annotations = createLine(renderer.regl, {
      color: annotationLineColor,
      width: annotationLineWidth,
      is2d: true,
    });
    computePointSizeMouseDetection();

    // Event listeners
    canvas.addEventListener('wheel', wheelHandler);

    // Buffers
    normalPointsIndexBuffer = renderer.regl.buffer();
    selectedPointsIndexBuffer = renderer.regl.buffer();
    hoveredPointIndexBuffer = renderer.regl.buffer({
      usage: 'dynamic',
      type: 'float',
      length: FLOAT_BYTES * 2, // This buffer is fixed to exactly 1 point consisting of 2 coordinates
    });

    colorTex = createColorTexture();
    encodingTex = createEncodingTexture();

    // Set dimensions
    const whenSet = set({
      backgroundImage,
      width,
      height,
      keyMap,
    });
    updateSelectInitiatorStyle();
    updateSelectLongPressIndicatorStyle();

    // Setup event handler
    window.addEventListener('keyup', keyUpHandler, false);
    window.addEventListener('blur', blurHandler, false);
    window.addEventListener('mouseup', mouseUpHandler, false);
    window.addEventListener('mousemove', mouseMoveHandler, false);
    canvas.addEventListener('mousedown', mouseDownHandler, false);
    canvas.addEventListener('mouseenter', mouseEnterCanvasHandler, false);
    canvas.addEventListener('mouseleave', mouseLeaveCanvasHandler, false);
    canvas.addEventListener('click', mouseClickHandler, false);
    canvas.addEventListener('dblclick', mouseDblClickHandler, false);

    if ('ResizeObserver' in window) {
      canvasObserver = new ResizeObserver(resizeHandler);
      canvasObserver.observe(canvas);
    } else {
      window.addEventListener('resize', resizeHandler);
      window.addEventListener('orientationchange', resizeHandler);
    }

    whenSet.then(() => {
      pubSub.publish('init');
    });
  };

  const cancelFrameListener = renderer.onFrame(() => {
    // Update camera: this needs to happen on every
    isViewChanged = camera.tick();

    if (!((isPointsDrawn || isAnnotationsDrawn) && (draw || isTransitioning))) {
      return;
    }

    if (isTransitioning && !tween(transitionDuration, transitionEasing)) {
      endTransition();
    }

    if (isViewChanged) {
      topRightNdc = getScatterGlPos(1, 1);
      bottomLeftNdc = getScatterGlPos(-1, -1);
      if (opacityBy === 'density') {
        getNumPointsInViewDb();
      }
    }

    renderer.render(() => {
      const widthRatio = canvas.width / renderer.canvas.width;
      const heightRatio = canvas.height / renderer.canvas.height;

      updateProjectionMatrix(widthRatio, heightRatio);

      if (backgroundImage?._reglType) {
        drawBackgroundImage();
      }

      if (
        selectionManager.type() === LASSO_SELECTION &&
        selectionPointsCurr.length > 2
      ) {
        drawLassoPolygon();
      }

      // The draw order of the following calls is important!
      if (!isTransitioning) {
        pointConnections.draw({
          projection: getProjection(),
          model: getModel(),
          view: getView(),
        });
      }

      if (isPointsDrawn) {
        drawPointBodies();
      }

      if (!mouseDown && (showReticle || drawReticleOnce)) {
        drawReticle();
      }

      if (hoveredPoint >= 0) {
        drawHoveredPoint();
      }

      if (selectedPoints.length) {
        drawSelectedPoints();
      }

      annotations.draw({
        projection: getProjection(),
        model: getModel(),
        view: getView(),
      });

      selectionOutline.draw({
        projection: getProjection(),
        model: getModel(),
        view: getView(),
      });
    }, canvas);

    const renderView = {
      view: camera.view,
      camera,
      xScale,
      yScale,
    };

    // Publish camera change
    if (isViewChanged) {
      updateScales();

      if (preventEventView) {
        preventEventView = false;
      } else {
        pubSub.publish('view', renderView);
      }
    }

    draw = false;
    drawReticleOnce = false;

    pubSub.publish('drawing', renderView, { async: false });
    pubSub.publish('draw', renderView);
  });

  const redraw = () => {
    draw = true;
  };

  const destroy = () => {
    isPointsDrawn = false;
    isAnnotationsDrawn = false;
    isDestroyed = true;
    cancelFrameListener();
    window.removeEventListener('keyup', keyUpHandler, false);
    window.removeEventListener('blur', blurHandler, false);
    window.removeEventListener('mouseup', mouseUpHandler, false);
    window.removeEventListener('mousemove', mouseMoveHandler, false);
    canvas.removeEventListener('mousedown', mouseDownHandler, false);
    canvas.removeEventListener('mouseenter', mouseEnterCanvasHandler, false);
    canvas.removeEventListener('mouseleave', mouseLeaveCanvasHandler, false);
    canvas.removeEventListener('click', mouseClickHandler, false);
    canvas.removeEventListener('dblclick', mouseDblClickHandler, false);
    canvas.removeEventListener('wheel', wheelHandler, false);
    if (canvasObserver) {
      canvasObserver.disconnect();
    } else {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('orientationchange', resizeHandler);
    }
    canvas = undefined;
    camera.dispose();
    camera = undefined;
    selectionOutline.destroy();
    selectionManager.destroy();
    pointConnections.destroy();
    reticleHLine.destroy();
    reticleVLine.destroy();
    if (!(initialProperties.renderer || renderer.isDestroyed)) {
      // Since the user did not pass in an externally created renderer we can
      // assume that the renderer is only used by this scatter plot instance.
      // Therefore it's save to destroy it when this scatter plot instance is
      // destroyed.
      renderer.destroy();
    }
    pubSub.publish('destroy');
    pubSub.clear();
  };

  init();

  return {
    /**
     * Get whether the browser supports all necessary WebGL features
     * @return {boolean} If `true` the browser supports all necessary WebGL features
     */
    get isSupported() {
      return renderer.isSupported;
    },
    clear: withDraw(clear),
    clearPoints: withDraw(clearPoints),
    clearPointConnections: withDraw(clearPointConnections),
    clearAnnotations: withDraw(clearAnnotations),
    createTextureFromUrl: (
      /** @type {string} */ url,
      /** @type {number} */ timeout = DEFAULT_IMAGE_LOAD_TIMEOUT,
    ) => createTextureFromUrl(renderer.regl, url, timeout),
    deselect,
    destroy,
    draw: publicDraw,
    drawAnnotations,
    filter,
    get,
    getScreenPosition,
    hover,
    redraw,
    refresh: renderer.refresh,
    reset: withDraw(reset),
    select,
    set,
    export: exportFn,
    subscribe: pubSub.subscribe,
    unfilter,
    unsubscribe: pubSub.unsubscribe,
    view,
    zoomToLocation,
    zoomToArea,
    zoomToPoints,
    zoomToOrigin,
    setSelectionManager,
  };
};

export default createScatterplot;

/**
 * Create spatial index from points.
 *
 * @description
 * The spatial index can be used with `scatterplot.draw(points, { spatialIndex })`
 * to drastically speed up the draw call.
 *
 * @param {import('./types').Points} points - The points for which to create the spatial index.
 * @param {boolean=} useWorker - Whether to create the spatial index in a worker thread or not. If `undefined`, the spatial index will be created in a worker if `points` contains more than one million entries.
 * @return {Promise<ArrayBuffer>} Spatial index
 */
const createSpatialIndex = (points, useWorker) =>
  toArrayOrientedPoints(points)
    .then((arrayPoints) => createKdbush(arrayPoints, { useWorker }))
    .then((index) => index.data);

export {
  createRegl,
  createRenderer,
  createSpatialIndex,
  createTextureFromUrl,
  checkSupport,
};
