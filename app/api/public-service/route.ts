import { NextResponse } from "next/server";
import { fetchPublicServiceTestFromServer } from "@/lib/public-service.server";

export async function GET() {
  try {
    const data = await fetchPublicServiceTestFromServer();
    return NextResponse.json(data);
  } catch (error) {
    console.error("외부 API 연동 중 오류 발생:", error);

    return NextResponse.json(
      { error: "외부 API 호출 중 네트워크 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
