// Adapted from nom 5.1.3 src/sequence/macros.rs (MIT), retaining parser behavior.
// Remove expression-position trailing semicolons rejected by newer Rust compilers.
macro_rules! do_parse (
  (__impl $i:expr, ( $($rest:expr),* )) => (
    std::result::Result::Ok(($i, ( $($rest),* )))
  );

  (__impl $i:expr, $field:ident : $submac:ident!( $($args:tt)* ) ) => (
    do_parse!(__impl $i, $submac!( $($args)* ))
  );

  (__impl $i:expr, $submac:ident!( $($args:tt)* ) ) => (
    nom_compile_error!("do_parse is missing the return value. A do_parse call must end
      with a return value between parenthesis, as follows:

      do_parse!(
        a: tag!(\"abcd\") >>
        b: tag!(\"efgh\") >>

        ( Value { a: a, b: b } )
    ");
  );

  (__impl $i:expr, $field:ident : $submac:ident!( $($args:tt)* ) ~ $($rest:tt)* ) => (
    nom_compile_error!("do_parse uses >> as separator, not ~");
  );
  (__impl $i:expr, $submac:ident!( $($args:tt)* ) ~ $($rest:tt)* ) => (
    nom_compile_error!("do_parse uses >> as separator, not ~");
  );
  (__impl $i:expr, $field:ident : $e:ident ~ $($rest:tt)*) => (
    do_parse!(__impl $i, $field: call!($e) ~ $($rest)*)
  );
  (__impl $i:expr, $e:ident ~ $($rest:tt)*) => (
    do_parse!(__impl $i, call!($e) ~ $($rest)*)
  );

  (__impl $i:expr, $e:ident >> $($rest:tt)*) => (
    do_parse!(__impl $i, call!($e) >> $($rest)*)
  );
  (__impl $i:expr, $submac:ident!( $($args:tt)* ) >> $($rest:tt)*) => (
    {
      use std::result::Result::*;

      let i_ = $i.clone();
      match $submac!(i_, $($args)*) {
        Err(e) => Err(e),
        Ok((i,_))     => {
          let i_ = i.clone();
          do_parse!(__impl i_, $($rest)*)
        },
      }
    }
  );

  (__impl $i:expr, $field:ident : $e:ident >> $($rest:tt)*) => (
    do_parse!(__impl $i, $field: call!($e) >> $($rest)*)
  );

  (__impl $i:expr, $field:ident : $submac:ident!( $($args:tt)* ) >> $($rest:tt)*) => (
    {
      use std::result::Result::*;

      let i_ = $i.clone();
      match  $submac!(i_, $($args)*) {
        Err(e) => Err(e),
        Ok((i,o))     => {
          let $field = o;
          let i_ = i.clone();
          do_parse!(__impl i_, $($rest)*)
        },
      }
    }
  );

  // ending the chain
  (__impl $i:expr, $e:ident >> ( $($rest:tt)* )) => (
    do_parse!(__impl $i, call!($e) >> ( $($rest)* ))
  );

  (__impl $i:expr, $submac:ident!( $($args:tt)* ) >> ( $($rest:tt)* )) => ({
    use std::result::Result::*;

    match $submac!($i, $($args)*) {
      Err(e) => Err(e),
      Ok((i,_))     => {
        do_parse!(__finalize i, $($rest)*)
      },
    }
  });

  (__impl $i:expr, $field:ident : $e:ident >> ( $($rest:tt)* )) => (
    do_parse!(__impl $i, $field: call!($e) >> ( $($rest)* ) )
  );

  (__impl $i:expr, $field:ident : $submac:ident!( $($args:tt)* ) >> ( $($rest:tt)* )) => ({
    use std::result::Result::*;

    match $submac!($i, $($args)*) {
      Err(e) => Err(e),
      Ok((i,o))     => {
        let $field = o;
        do_parse!(__finalize i, $($rest)*)
      },
    }
  });

  (__finalize $i:expr, ( $o: expr )) => ({
    use std::result::Result::Ok;
    Ok(($i, $o))
  });

  (__finalize $i:expr, ( $($rest:tt)* )) => ({
    use std::result::Result::Ok;
    Ok(($i, ( $($rest)* )))
  });

  ($i:expr, $($rest:tt)*) => (
    {
      do_parse!(__impl $i, $($rest)*)
    }
  );
  ($submac:ident!( $($args:tt)* ) >> $($rest:tt)* ) => (
    nom_compile_error!("if you are using do_parse outside of a named! macro, you must
        pass the input data as first argument, like this:

        let res = do_parse!(input,
          a: tag!(\"abcd\") >>
          b: tag!(\"efgh\") >>
          ( Value { a: a, b: b } )
        );");
  );
  ($e:ident! >> $($rest:tt)* ) => (
    do_parse!( call!($e) >> $($rest)*)
  );
);

