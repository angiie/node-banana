import { NextRequest, NextResponse } from "next/server";
import { setupProxy } from "@/utils/setupProxy";

export async function GET(_request: NextRequest): Promise<NextResponse> {
  setupProxy();

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        reachable: false,
        reason: "GEMINI_API_KEY 未配置，无法验证完整调用链路",
      },
      { status: 500 }
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(
    apiKey
  )}`;

  try {
    const startedAt = Date.now();

    const response = await fetch(url, {
      method: "GET",
    });

    const durationMs = Date.now() - startedAt;

    // 只要能拿到 HTTP 响应，就说明代理链路是通的（即便是 4xx）
    const text = await response.text().catch(() => "");

    return NextResponse.json(
      {
        success: true,
        reachable: true,
        status: response.status,
        ok: response.ok,
        durationMs,
        message:
          "已通过当前代理尝试访问 Gemini models 接口，请根据 status/ok 判断是否可用",
        preview: text.slice(0, 300),
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "未知错误（非 Error 实例）";

    return NextResponse.json(
      {
        success: false,
        reachable: false,
        reason: "通过代理访问 Gemini 接口失败，可能是 7890 未生效或被阻断",
        error: message,
      },
      { status: 500 }
    );
  }
}
