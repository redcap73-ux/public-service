import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>페이지를 찾을 수 없습니다</h1>
        <p style={{ marginBottom: "1rem" }}>요청하신 경로는 존재하지 않습니다.</p>
        <Link href="/" style={{ color: "#2563eb", textDecoration: "underline" }}>
          홈으로 돌아가기
        </Link>
      </div>
    </main>
  );
}
