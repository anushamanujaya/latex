import argon2 from 'argon2';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from './db.js';
import { User } from './models.js';

const input = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(14).max(128)
    .regex(/[a-z]/, 'Password requires a lowercase letter')
    .regex(/[A-Z]/, 'Password requires an uppercase letter')
    .regex(/[0-9]/, 'Password requires a number')
    .regex(/[^A-Za-z0-9]/, 'Password requires a symbol'),
}).parse({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, password: process.env.ADMIN_PASSWORD });

await connectDatabase();
try {
  const userCount = await User.countDocuments();
  if (userCount !== 0) throw new Error('Administrator bootstrap refused: the database already contains users');
  await User.create({ name: input.name, email: input.email, passwordHash: await argon2.hash(input.password), role: 'ADMIN', active: true });
  console.log(`Initial administrator created for ${input.email}. The password was not printed.`);
} finally {
  await disconnectDatabase();
}
