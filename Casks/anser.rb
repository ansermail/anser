cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.33"
  sha256 arm:   "9359ca8a4bfa47ac034213f98825efc9fd2b771319e483a01950b1f4c1eaf32e",
         intel: "f8937a21ce58bfd3e7009d078d04db9501359df6a68271f36789805f8baee404"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
