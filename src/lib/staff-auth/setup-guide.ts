// The first-run guide on /personale (M25a, plan §3.1.10): four steps that get the staff into the app. Pure: the
// counts come from the two replies the page already reads, and this only decides which steps are done, whether
// the guide folds away, and whether to warn that PIN login is not switched on at the server.

export type GuideState = "done" | "todo" | null;

export interface GuideStep {
  number: 1 | 2 | 3 | 4;
  titleKey: `guide.step${1 | 2 | 3 | 4}.title`;
  bodyKey: `guide.step${1 | 2 | 3 | 4}.body`;
  /** Steps 1 and 3 have a state; installing the app and the daily routine have none. */
  state: GuideState;
}

export interface SetupGuide {
  warning: "pin_not_ready" | null;
  /** True when people and devices are both set up (and PIN login works): the guide folds into a button. */
  collapsed: boolean;
  steps: GuideStep[];
}

const step = (number: GuideStep["number"], state: GuideState): GuideStep => ({
  number,
  titleKey: `guide.step${number}.title`,
  bodyKey: `guide.step${number}.body`,
  state,
});

export function setupGuide(input: {
  staffCount: number;
  deviceCount: number;
  pinLoginReady: boolean;
}): SetupGuide {
  const peopleDone = input.staffCount >= 1;
  const devicesDone = input.deviceCount >= 1;
  return {
    warning: input.pinLoginReady ? null : "pin_not_ready",
    collapsed: peopleDone && devicesDone && input.pinLoginReady,
    steps: [
      step(1, peopleDone ? "done" : "todo"),
      step(2, null),
      step(3, devicesDone ? "done" : "todo"),
      step(4, null),
    ],
  };
}

export const countActiveStaff = (staff: readonly { active: boolean }[]): number =>
  staff.filter((person) => person.active).length;

export const countActiveDevices = (devices: readonly { status: string }[]): number =>
  devices.filter((device) => device.status !== "revocato").length;
