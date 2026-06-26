import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0710" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "80%", height: "80%", borderRadius: "24%", background: "linear-gradient(135deg, #f2d488, #b8863a)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "54%", height: "54%", borderRadius: "50%", background: "#0a0710" }}>
            <div style={{ width: "34%", height: "34%", borderRadius: "50%", background: "#f2d488" }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
