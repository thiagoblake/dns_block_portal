import "./globals.css";

export const metadata = {
  title: "DNS Block Portal",
  description: "Portal administrativo de bloqueios DNS para Unbound"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
