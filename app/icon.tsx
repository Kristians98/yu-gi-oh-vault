import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Millennium-eye gem, drawn with nested divs (Satori-safe — no fonts/SVG paths).
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0710" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "78%", height: "78%", borderRadius: "24%", background: "linear-gradient(135deg, #f2d488, #b8863a)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "54%", height: "54%", borderRadius: "50%", background: "#0a0710" }}>
            <div style={{ width: "34%", height: "34%", borderRadius: "50%", background: "#f2d488" }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
