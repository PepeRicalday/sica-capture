/**
 * trabajoSinGuardar — registro global de captura en curso.
 *
 * VersionGuard recarga la app sola al detectar una versión nueva en la nube.
 * En campo eso puede entrar a media captura de un aforo y borrar lo que el
 * operador llevaba escrito, que es trabajo que no se recupera: el aforo se
 * midió una vez, con el molinete ya guardado.
 *
 * Los formularios declaran aquí cuándo tienen datos sin enviar. Mientras haya
 * al menos uno, la actualización automática cede y se muestra el banner para
 * que el operador decida el momento.
 *
 * Es un módulo, no un contexto de React, a propósito: VersionGuard envuelve al
 * router y monta por encima de los formularios, así que no puede leer su
 * estado por props ni por contexto.
 */

const activos = new Set<string>();

type Escucha = (hay: boolean) => void;
const escuchas = new Set<Escucha>();

const notificar = () => {
    const hay = activos.size > 0;
    for (const fn of escuchas) fn(hay);
};

/** Marca (o desmarca) un formulario como portador de datos sin guardar. */
export const marcarTrabajoSinGuardar = (id: string, sucio: boolean): void => {
    const antes = activos.size;
    if (sucio) activos.add(id);
    else activos.delete(id);
    if (activos.size !== antes) notificar();
};

/** ¿Hay algún formulario con captura sin enviar en este momento? */
export const hayTrabajoSinGuardar = (): boolean => activos.size > 0;

/**
 * Avisa cuando el estado cambia. Lo usa VersionGuard para actualizar en cuanto
 * el operador termina de guardar, sin esperar a que recargue por su cuenta.
 * Devuelve la función para darse de baja.
 */
export const observarTrabajoSinGuardar = (fn: Escucha): (() => void) => {
    escuchas.add(fn);
    return () => { escuchas.delete(fn); };
};
