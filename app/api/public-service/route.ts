import { NextResponse } from "next/server";

const SERVER_A_URL = "http://100.65.181.94/api/publicservice/test";

export async function GET() {
  const apiKey = process.env.MY_SECRET_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "서버 API 키가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(SERVER_A_URL, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `외부 API 호출 실패: 상태 코드 ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("외부 API 연동 중 오류 발생:", error);

    return NextResponse.json(
      { error: "외부 API 호출 중 네트워크 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
