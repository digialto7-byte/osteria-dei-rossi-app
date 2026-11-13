import Link from "next/link";
import { BrandLink } from "@/components/brand";
import { HeaderBand } from "@/components/header-band";
import { PageMain } from "@/components/page-main";
import { Heading, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";

// The band left the root layout (QW1), so the 404 brings its own, and a way back.
export default function NotFound() {
  return (
    <>
      <HeaderBand brand={<BrandLink />} />
      <PageMain>
        <Heading>{t("notFound.title")}</Heading>
        <Link href="/" className={`${linkClass} self-start`}>
          {t("notFound.home")}
        </Link>
      </PageMain>
    </>
  );
}
