import { Router } from 'express';
import { RegisterDto, LoginDto } from '@sofia/shared-kernel';
import { validate } from '../middlewares/validate';
import { requireAuth } from '../middlewares/auth.guard';
import { authController } from './auth.controller';

export const authRouter = Router();

authRouter.post('/register', validate(RegisterDto), authController.register);
authRouter.post('/login', validate(LoginDto), authController.login);
authRouter.get('/me', requireAuth, authController.me);
