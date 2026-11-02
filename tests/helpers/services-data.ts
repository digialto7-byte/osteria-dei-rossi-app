// Fixtures of the M25c service endpoints (fake data only).

export const SERVICE_PERIODS = {
  periods: [
    { key: "pranzo", name: "Pranzo", startsAt: "11:00", endsAt: "16:00" },
    { key: "cena", name: "Cena", startsAt: "16:00", endsAt: "02:00" },
  ],
  cutoff: "02:00",
  since: null as string | null,
  isDefault: true,
};

export const SET_SERVICE_PERIODS = {
  periods: [
    { key: "pranzo", name: "Pranzo", startsAt: "11:00", endsAt: "18:00" },
    { key: "s_0123456789", name: "Aperitivo", startsAt: "18:00", endsAt: "19:30" },
    { key: "cena", name: "Cena", startsAt: "19:30", endsAt: "02:00" },
  ],
  cutoff: "02:00",
  since: "2026-11-05T09:00:00+00:00",
  isDefault: false,
  changed: true,
};
