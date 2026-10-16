import { createContext, useContext } from "react";
export const ReminderContext = createContext({ count: 0, error: false });
export const useReminderStatus = () => useContext(ReminderContext);
