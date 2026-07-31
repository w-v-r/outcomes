import { permanentRedirect } from "next/navigation";

const LegacyDashboardPage = () => {
  permanentRedirect("/console");
};

export default LegacyDashboardPage;
