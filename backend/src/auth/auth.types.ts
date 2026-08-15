import type { User } from '@prisma/client';

export type AuthenticatedUser = Readonly<Pick<User, 'email' | 'id' | 'role' | 'username'>>;

export type RequestWithOptionalUser = {
  user?: AuthenticatedUser;
};

export type AuthenticatedRequest = {
  user: AuthenticatedUser;
};
