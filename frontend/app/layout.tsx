import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Zoom Clone",
  description: "Scaler full-stack assignment Zoom clone"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

