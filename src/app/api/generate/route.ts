import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { GenerateRequest, GenerateResponse, ModelType } from "@/types";
import { setupProxy } from "@/utils/setupProxy";

const ENABLE_DEBUG_LOGS = process.env.GENERATE_DEBUG === "1";

const debugLog = (...args: unknown[]) => {
  if (!ENABLE_DEBUG_LOGS) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

const debugWarn = (...args: unknown[]) => {
  if (!ENABLE_DEBUG_LOGS) return;
  // eslint-disable-next-line no-console
  console.warn(...args);
};

export const maxDuration = 300;
export const dynamic = "force-dynamic";

setupProxy();

// Map model types to Gemini model IDs
const MODEL_MAP: Record<ModelType, string> = {
  "nano-banana": "gemini-2.5-flash-image", // Updated to correct model name
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  debugLog(`\n[API:${requestId}] ========== NEW GENERATE REQUEST ==========`);
  debugLog(`[API:${requestId}] Timestamp: ${new Date().toISOString()}`);

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error(`[API:${requestId}] ❌ No API key configured`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "API key not configured. Add GEMINI_API_KEY to .env.local",
        },
        { status: 500 }
      );
    }

    debugLog(`[API:${requestId}] Parsing request body...`);
    const body: GenerateRequest = await request.json();
    const { images, prompt, model = "nano-banana-pro", aspectRatio, resolution, useGoogleSearch } = body;

    debugLog(`[API:${requestId}] Request parameters:`);
    debugLog(`[API:${requestId}]   - Model: ${model} -> ${MODEL_MAP[model]}`);
    debugLog(`[API:${requestId}]   - Images count: ${images?.length || 0}`);
    debugLog(`[API:${requestId}]   - Prompt length: ${prompt?.length || 0} chars`);
    debugLog(`[API:${requestId}]   - Aspect Ratio: ${aspectRatio || "default"}`);
    debugLog(`[API:${requestId}]   - Resolution: ${resolution || "default"}`);
    debugLog(`[API:${requestId}]   - Google Search: ${useGoogleSearch || false}`);

    if (!images || images.length === 0 || !prompt) {
      // eslint-disable-next-line no-console
      console.error(`[API:${requestId}] ❌ Validation failed: missing images or prompt`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "At least one image and prompt are required",
        },
        { status: 400 }
      );
    }

    debugLog(`[API:${requestId}] Extracting image data...`);
    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    const BASE64_OVERHEAD_RATIO = 4 / 3;
    const MAX_BASE64_LENGTH = Math.floor(MAX_IMAGE_BYTES * BASE64_OVERHEAD_RATIO);

    const imageData = images.map((image, idx) => {
      if (image.includes("base64,")) {
        const [header, data] = image.split("base64,");
        if (data.length > MAX_BASE64_LENGTH) {
          throw new Error(`Image ${idx + 1} exceeds 20MB limit`);
        }
        const mimeMatch = header.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
        debugLog(
          `[API:${requestId}]   Image ${idx + 1}: ${mimeType}, ${(data.length / 1024).toFixed(2)}KB base64`
        );
        return { data, mimeType };
      }
      if (image.length > MAX_BASE64_LENGTH) {
        throw new Error(`Image ${idx + 1} exceeds 20MB limit`);
      }
      debugLog(
        `[API:${requestId}]   Image ${idx + 1}: No base64 header, assuming PNG, ${(image.length / 1024).toFixed(
          2
        )}KB`
      );
      return { data: image, mimeType: "image/png" };
    });

    // Initialize Gemini client
    debugLog(`[API:${requestId}] Initializing Gemini client...`);
    const ai = new GoogleGenAI({ apiKey });

    // Build request parts array with prompt and all images
    debugLog(`[API:${requestId}] Building request parts...`);
    const requestParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
      ...imageData.map(({ data, mimeType }) => ({
        inlineData: {
          mimeType,
          data,
        },
      })),
    ];
    debugLog(
      `[API:${requestId}] Request parts count: ${requestParts.length} (1 text + ${imageData.length} images)`
    );

    // Build config object based on model capabilities
    debugLog(`[API:${requestId}] Building generation config...`);
    const config: any = {
      responseModalities: ["IMAGE", "TEXT"],
    };

    // Add imageConfig for both models (both support aspect ratio)
    if (aspectRatio) {
      config.imageConfig = {
        aspectRatio,
      };
      debugLog(`[API:${requestId}]   Added aspect ratio: ${aspectRatio}`);
    }

    // Add resolution only for Nano Banana Pro
    if (model === "nano-banana-pro" && resolution) {
      if (!config.imageConfig) {
        config.imageConfig = {};
      }
      config.imageConfig.imageSize = resolution;
      debugLog(`[API:${requestId}]   Added resolution: ${resolution}`);
    }

    // Add tools array for Google Search (only Nano Banana Pro)
    const tools = [];
    if (model === "nano-banana-pro" && useGoogleSearch) {
      tools.push({ googleSearch: {} });
      debugLog(`[API:${requestId}]   Added Google Search tool`);
    }

    debugLog(`[API:${requestId}] Final config:`, JSON.stringify(config, null, 2));
    if (tools.length > 0) {
      debugLog(`[API:${requestId}] Tools:`, JSON.stringify(tools, null, 2));
    }

    const modelRequest = {
      model: MODEL_MAP[model],
      contents: [
        {
          role: "user",
          parts: requestParts,
        },
      ],
      config,
      ...(tools.length > 0 && { tools }),
    };

    debugLog(`[API:${requestId}] Calling Gemini API...`);
    debugLog(`[API:${requestId}] Full Gemini request:`, JSON.stringify(modelRequest, null, 2));

    const geminiStartTime = Date.now();

    const response = await ai.models.generateContent(modelRequest);

    const geminiDuration = Date.now() - geminiStartTime;
    debugLog(`[API:${requestId}] Gemini API call completed in ${geminiDuration}ms`);

    debugLog(`[API:${requestId}] Processing response...`);
    const candidates = response.candidates;
    debugLog(`[API:${requestId}] Candidates count: ${candidates?.length || 0}`);

    if (!candidates || candidates.length === 0) {
      console.error(`[API:${requestId}] ❌ No candidates in response`);
      console.error(`[API:${requestId}] Full response:`, JSON.stringify(response, null, 2));
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "No response from AI model",
        },
        { status: 500 }
      );
    }

    const parts = candidates[0].content?.parts;
    debugLog(`[API:${requestId}] Parts count in first candidate: ${parts?.length || 0}`);

    if (!parts) {
      console.error(`[API:${requestId}] ❌ No parts in candidate content`);
      console.error(`[API:${requestId}] Candidate:`, JSON.stringify(candidates[0], null, 2));
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "No content in response",
        },
        { status: 500 }
      );
    }

    // Log all parts
    parts.forEach((part, idx) => {
      const partKeys = Object.keys(part);
      debugLog(`[API:${requestId}] Part ${idx + 1}: ${partKeys.join(", ")}`);
    });

    // Find image part in response
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        const mimeType = part.inlineData.mimeType || "image/png";
        const imageData = part.inlineData.data;
        const imageSizeKB = (imageData.length / 1024).toFixed(2);
        debugLog(`[API:${requestId}] ✓ Found image in response: ${mimeType}, ${imageSizeKB}KB base64`);

        const dataUrl = `data:${mimeType};base64,${imageData}`;
        const dataUrlSizeKB = (dataUrl.length / 1024).toFixed(2);
        debugLog(`[API:${requestId}] Data URL size: ${dataUrlSizeKB}KB`);

        const responsePayload = { success: true, image: dataUrl };
        const responseSize = JSON.stringify(responsePayload).length;
        const responseSizeMB = (responseSize / (1024 * 1024)).toFixed(2);
        debugLog(`[API:${requestId}] Total response payload size: ${responseSizeMB}MB`);

        if (responseSize > 4.5 * 1024 * 1024) {
          debugWarn(
            `[API:${requestId}] ⚠️ Response size (${responseSizeMB}MB) is approaching Next.js 5MB limit!`
          );
        }

        debugLog(`[API:${requestId}] ✓✓✓ SUCCESS - Returning image ✓✓✓`);
        const response = NextResponse.json<GenerateResponse>(responsePayload);
        response.headers.set("Content-Type", "application/json");
        response.headers.set("Content-Length", responseSize.toString());

        debugLog(`[API:${requestId}] Response headers set, returning...`);
        return response;
      }
    }

    // If no image found, check for text error
    debugWarn(`[API:${requestId}] ⚠ No image found in parts, checking for text...`);
    for (const part of parts) {
      if (part.text) {
        console.error(`[API:${requestId}] ❌ Model returned text instead of image`);
        console.error(`[API:${requestId}] Text preview: "${part.text.substring(0, 200)}"`);
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
          },
          { status: 500 }
        );
      }
    }

    console.error(`[API:${requestId}] ❌ No image or text found in response`);
    console.error(`[API:${requestId}] All parts:`, JSON.stringify(parts, null, 2));
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No image in response",
      },
      { status: 500 }
    );
  } catch (error) {
    const requestId = 'unknown'; // Fallback if we don't have it in scope
    console.error(`[API:${requestId}] ❌❌❌ EXCEPTION CAUGHT IN API ROUTE ❌❌❌`);
    console.error(`[API:${requestId}] Error type:`, error?.constructor?.name);
    console.error(`[API:${requestId}] Error toString:`, String(error));

    // Extract detailed error information
    let errorMessage = "Generation failed";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || "";
      console.error(`[API:${requestId}] Error message:`, errorMessage);
      console.error(`[API:${requestId}] Error stack:`, error.stack);

      // Check for specific error types
      if ("cause" in error && error.cause) {
        console.error(`[API:${requestId}] Error cause:`, error.cause);
        errorDetails += `\nCause: ${JSON.stringify(error.cause)}`;
      }
    }

    // Try to extract more details from Google API errors
    if (error && typeof error === "object") {
      const apiError = error as Record<string, unknown>;
      console.error(`[API:${requestId}] Error object keys:`, Object.keys(apiError));

      if (apiError.status) {
        console.error(`[API:${requestId}] Error status:`, apiError.status);
        errorDetails += `\nStatus: ${apiError.status}`;
      }
      if (apiError.statusText) {
        console.error(`[API:${requestId}] Error statusText:`, apiError.statusText);
        errorDetails += `\nStatusText: ${apiError.statusText}`;
      }
      if (apiError.errorDetails) {
        console.error(`[API:${requestId}] Error errorDetails:`, apiError.errorDetails);
        errorDetails += `\nDetails: ${JSON.stringify(apiError.errorDetails)}`;
      }
      if (apiError.response) {
        try {
          console.error(`[API:${requestId}] Error response:`, apiError.response);
          errorDetails += `\nResponse: ${JSON.stringify(apiError.response)}`;
        } catch {
          errorDetails += `\nResponse: [unable to stringify]`;
        }
      }

      // Log entire error object for debugging
      try {
        console.error(`[API:${requestId}] Full error object:`, JSON.stringify(apiError, null, 2));
      } catch {
        console.error(`[API:${requestId}] Could not stringify full error object`);
      }
    }

    console.error(`[API:${requestId}] Compiled error details:`, errorDetails);

    // Handle rate limiting
    if (errorMessage.includes("429")) {
      console.error(`[API:${requestId}] Rate limit error detected`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait and try again.",
        },
        { status: 429 }
      );
    }

    console.error(`[API:${requestId}] Returning 500 error response`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: `${errorMessage}${errorDetails ? ` | Details: ${errorDetails.substring(0, 500)}` : ""}`,
      },
      { status: 500 }
    );
  }
}
