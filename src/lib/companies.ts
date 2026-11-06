import returnlogic from '../assets/logos/returnlogic.png?inline';
import actifai from '../assets/logos/actifai.png?inline';

const logo = (name: string, src: string, w: number, h: number) => ({
  name,
  src,
  /** Logo width at a given display height, keeping the image's proportions. */
  widthAt: (height: number) => Math.round((height * w) / h),
});

export const companies = {
  returnlogic: logo('ReturnLogic', returnlogic, 113, 128),
  actifai: logo('Actifai', actifai, 120, 128),
};
