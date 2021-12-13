{ pkgs ? import <nixpkgs> {} }: # TODO: This is nixpkgs 21.05, pin the nixpkgs ver

with pkgs;

mkShell {
  buildInputs = [
    # git
    # gcc
    # libc6-dev?
    # pkg-config
    # libssl-dev?
    # libclang-dev
    pkg-config
    # llvm
    # nix-tree
    openssl
    # llvmPackages.libclang
    llvm
    clang
    rustup
    nodejs-14_x # somehow this avoids getting mixed with system's nodejs.
    # libsodium
  ];
     # export SNAPPY_LIB_DIR=/usr/local/lib
     # alias capsule=$HOME/.cargo/bin/capsule
     # alias ckb-cli=$HOME/projects/ckb-cli/target/release/ckb-cli
     # alias ckb=$HOME/projects/ckb/target/release/ckb
     # LIBCLANG_PATH=${pkgs.llvmPackages.libclang.lib}/lib
  shellHook = ''
     export LIBCLANG_PATH=${pkgs.llvmPackages.libclang.lib}/lib
     export PATH=$PATH:~/.local/bin
     export PATH=$PATH:~/.cargo/bin
  '';
}
