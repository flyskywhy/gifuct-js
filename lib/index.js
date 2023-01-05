"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.decompressFrames = exports.decompressFrame = exports.parseGIF = void 0;

var _gif = _interopRequireDefault(require("js-binary-schema-parser/lib/schemas/gif"));

var _jsBinarySchemaParser = require("js-binary-schema-parser");

var _uint = require("js-binary-schema-parser/lib/parsers/uint8");

require("@flyskywhy/react-native-browser-polyfill");

var _pixel = require("@rgba-image/pixel");

var _deinterlace = require("./deinterlace");

var _lzw = require("./lzw");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var parseGIF = function parseGIF(arrayBuffer) {
  var byteData = new Uint8Array(arrayBuffer);
  return (0, _jsBinarySchemaParser.parse)((0, _uint.buildStream)(byteData), _gif["default"]);
};

exports.parseGIF = parseGIF;

var generatePatch = function generatePatch(image) {
  var totalPixels = image.pixels.length;
  var patchData = new Uint8ClampedArray(totalPixels * 4);

  for (var i = 0; i < totalPixels; i++) {
    var pos = i * 4;
    var colorIndex = image.pixels[i];
    var color = image.colorTable[colorIndex] || [0, 0, 0];
    patchData[pos] = color[0];
    patchData[pos + 1] = color[1];
    patchData[pos + 2] = color[2];
    patchData[pos + 3] = colorIndex !== image.transparentIndex ? 255 : 0;
  }

  return patchData;
};

var decompressFrame = function decompressFrame(frame, gct, buildImagePatch) {
  if (!frame.image) {
    console.warn('gif frame does not have associated image.');
    return;
  }

  var image = frame.image; // get the number of pixels

  var totalPixels = image.descriptor.width * image.descriptor.height; // do lzw decompression

  var pixels = (0, _lzw.lzw)(image.data.minCodeSize, image.data.blocks, totalPixels); // deal with interlacing if necessary

  if (image.descriptor.lct.interlaced) {
    pixels = (0, _deinterlace.deinterlace)(pixels, image.descriptor.width);
  }

  var resultImage = {
    pixels: pixels,
    dims: {
      top: frame.image.descriptor.top,
      left: frame.image.descriptor.left,
      width: frame.image.descriptor.width,
      height: frame.image.descriptor.height
    }
  }; // color table

  if (image.descriptor.lct && image.descriptor.lct.exists) {
    resultImage.colorTable = image.lct;
  } else {
    resultImage.colorTable = gct;
  } // add per frame relevant gce information


  if (frame.gce) {
    resultImage.delay = (frame.gce.delay || 10) * 10; // convert to ms

    resultImage.disposalType = frame.gce.extras.disposal; // transparency

    if (frame.gce.extras.transparentColorGiven) {
      resultImage.transparentIndex = frame.gce.transparentColorIndex;
    }
  } // create canvas usable imagedata if desired


  if (buildImagePatch) {
    resultImage.patch = generatePatch(resultImage);
  }

  return resultImage;
};

exports.decompressFrame = decompressFrame;

var generateImageData = function generateImageData(parsedGif, resultImages) {
  var _parsedGif$lsd = parsedGif.lsd,
      width = _parsedGif$lsd.width,
      height = _parsedGif$lsd.height;
  var gifNeedsDisposal = false;

  for (var i = 0; i < resultImages.length; i++) {
    var resultImage = resultImages[i];

    if (width * height * 4 === resultImage.patch.length) {
      resultImage.imageData = new ImageData(resultImage.patch, width, height);
    } else if (i > 0) {
      var imageData = new ImageData(new Uint8ClampedArray(resultImages[i - 1].imageData.data), width, height);
      var left = resultImage.dims.left;
      var top = resultImage.dims.top;
      var dimsWidth = resultImage.dims.width;
      var dimsHeight = resultImage.dims.height;
      var patch = resultImage.patch;
      var index = void 0;

      if (gifNeedsDisposal) {
        for (var y = 0; y < dimsHeight; y++) {
          for (var x = 0; x < dimsWidth; x++) {
            (0, _pixel.setPixel)(imageData, x + left, y + top, 0, 0, 0, 0);
          }
        }

        gifNeedsDisposal = false;
      }

      for (var _y = 0; _y < dimsHeight; _y++) {
        for (var _x = 0; _x < dimsWidth; _x++) {
          index = (_y * dimsWidth + _x) * 4;
          (0, _pixel.setPixel)(imageData, _x + left, _y + top, patch[index], patch[index + 1], patch[index + 2], patch[index + 3]);
        }
      } // ref to https://github.com/matt-way/gifuct-js/issues/35


      if (resultImage.disposalType === 2) {
        gifNeedsDisposal = true;
      }

      resultImage.imageData = imageData;
    }
  }
};

var decompressFrames = function decompressFrames(parsedGif, buildImagePatches, buildImageData) {
  // in case gif file generated by https://products.aspose.app/imaging/animation-maker behavior:
  //     1st frame has gce but no image
  //     2nd frame has image but no gce
  var firstGce = parsedGif.frames.length ? parsedGif.frames[0].gce : undefined;
  var resultImages = parsedGif.frames.filter(function (f) {
    return f.image;
  }).map(function (f) {
    return decompressFrame(_objectSpread({
      gce: firstGce
    }, f), parsedGif.gct, buildImagePatches);
  });

  if (buildImagePatches && buildImageData) {
    generateImageData(parsedGif, resultImages);
  }

  return resultImages;
};

exports.decompressFrames = decompressFrames;