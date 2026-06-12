export type GroupRole = "admin" | "member";
export type GroupStatus = "active" | "invited" | "removed";

export type AppGroup = {
  id: string;
  name: string;
  role: GroupRole;
  status: GroupStatus;
};
