/** Geri dönməz əməliyyatlarda (silmə) istifadəçinin yazmalı olduğu söz */
export const DELETE_CONFIRM_WORD = "sil";

export const matchesConfirmWord = (input: string) => input.trim().toLocaleLowerCase("az") === DELETE_CONFIRM_WORD;
