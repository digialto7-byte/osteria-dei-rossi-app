import { redirect } from "next/navigation";

// The staff PIN screen now lives on /login (M25a). Old bookmarks and home-screen starts still land there.
export default function PinPage(): never {
  redirect("/login");
}
